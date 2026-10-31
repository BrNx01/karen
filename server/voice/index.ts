import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { speakSapi } from './speech.js';

export type VoiceStatus = 'unavailable' | 'ready' | 'no-model';

export type VoiceInfo = {
  status: VoiceStatus;
  lang: string;
  whisper: { binary: string | null; model: string | null };
  speech: { available: boolean; voices: { name: string; culture: string }[]; turkish: boolean };
};

export function voiceDir(dataDir = join(homedir(), '.karen')): string {
  // The voice model is large; it must be shareable between different data folders.
  const override = process.env['KAREN_VOICE_DIR'];
  if (override) return override;
  return join(dataDir, 'voice');
}

/**
 * In recent whisper.cpp versions the real workhorse is `whisper-server.exe`; the CLI
 * (`main.exe`) is deprecated and does not accept `--port`. So only the server
 * binary is looked for — there should be no "looks installed but does not work" state.
 */
export function whisperBinaryCandidates(dataDir?: string): string[] {
  const dir = voiceDir(dataDir);
  return [
    join(dir, 'bin', 'whisper-server.exe'),
    join(dir, 'bin', 'Release', 'whisper-server.exe'),
    join(dir, 'bin', 'whisper-server'),
    join(dir, 'bin', 'Release', 'whisper-server'),
  ];
}

export function whisperModelCandidates(dataDir?: string): string[] {
  const dir = voiceDir(dataDir);
  return [
    join(dir, 'models', 'ggml-base.bin'),
    join(dir, 'models', 'ggml-small.bin'),
    join(dir, 'models', 'ggml-tiny.bin'),
  ];
}

export function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}

/** Speech: lists the local SAPI voices (PowerShell). */
export function listSpeechVoices(): Promise<{ name: string; culture: string }[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    const script =
      'Add-Type -AssemblyName System.Speech; ' +
      '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ' +
      'ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture.Name }';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15_000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        const voices = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.includes('|'))
          .map((line) => {
            const [name, culture] = line.split('|');
            return { name: name ?? '', culture: culture ?? '' };
          })
          .filter((v) => v.name !== '');
        resolve(voices);
      },
    );
  });
}

export async function detectVoice(dataDir?: string, lang = 'tr-TR'): Promise<VoiceInfo> {
  const binary = firstExisting(whisperBinaryCandidates(dataDir));
  const model = firstExisting(whisperModelCandidates(dataDir));
  const voices = await listSpeechVoices();
  const turkish = voices.some((v) => v.culture.toLowerCase().startsWith('tr'));
  const status: VoiceStatus = !binary ? 'unavailable' : !model ? 'no-model' : 'ready';
  return {
    status,
    lang,
    whisper: { binary, model },
    speech: { available: voices.length > 0, voices, turkish },
  };
}

export type TranscribeResult = { ok: true; text: string } | { ok: false; reason: string };

/** Validates the WAV header: only PCM WAV is accepted. */
export function isWav(buf: Uint8Array): boolean {
  return (
    buf.length > 44 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  );
}

export function cleanTranscript(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, '').trim())
    .filter((line) => line !== '' && !/^\[.*\]$/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Local whisper server. It starts on first use, the model loads into memory,
 * and later transcriptions are fast. Audio never leaves the device.
 */
export class LocalWhisper {
  private child: ChildProcess | null = null;
  private port = 0;
  private starting: Promise<void> | null = null;

  constructor(
    private readonly opts: { dataDir?: string; binary?: string; model?: string; startupTimeoutMs?: number },
  ) {}

  info(): { binary: string | null; model: string | null } {
    return {
      binary: this.opts.binary ?? firstExisting(whisperBinaryCandidates(this.opts.dataDir)),
      model: this.opts.model ?? firstExisting(whisperModelCandidates(this.opts.dataDir)),
    };
  }

  private async ensure(): Promise<void> {
    if (this.child && this.port > 0) return;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const { binary, model } = this.info();
      if (!binary) throw new Error('whisper kurulu değil');
      if (!model) throw new Error('whisper modeli yok');

      const port = await freePort();
      const child = spawn(binary, ['-m', model, '--port', String(port), '--host', '127.0.0.1'], {
        cwd: dirname(binary),
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      // If the process never starts (broken exe) the process must not crash: clean up the state.
      const started = new Promise<void>((resolve, reject) => {
        child.once('error', (err) => {
          this.child = null;
          this.port = 0;
          reject(new Error(`whisper başlatılamadı: ${err.message}`));
        });
        child.once('spawn', () => resolve());
      });
      child.stderr?.on('data', () => undefined); // model loading log
      child.on('exit', () => {
        this.child = null;
        this.port = 0;
      });

      // stop() should work during startup too: we take ownership of the child immediately.
      this.child = child;
      this.port = port;
      await started;

      const deadline = Date.now() + (this.opts.startupTimeoutMs ?? 90_000);
      for (;;) {
        if (child.exitCode !== null) throw new Error('whisper sunucusu başlamadı');
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' });
          if (res.status < 500) break;
        } catch {
          /* not open yet */
        }
        if (Date.now() > deadline) {
          child.kill();
          throw new Error('whisper sunucusu zaman aşımına uğradı');
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    })();

    try {
      await this.starting;
    } catch (err) {
      this.child?.kill();
      this.child = null;
      this.port = 0;
      throw err;
    } finally {
      this.starting = null;
    }
  }

  async transcribe(wav: Uint8Array, lang = 'tr', timeoutMs = 120_000): Promise<TranscribeResult> {
    try {
      await this.ensure();
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
    try {
      const form = new FormData();
      form.append('file', new Blob([wav as unknown as BlobPart], { type: 'audio/wav' }), 'audio.wav');
      form.append('language', lang.slice(0, 2));
      form.append('response_format', 'json');
      const res = await fetch(`http://127.0.0.1:${this.port}/inference`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false, reason: `whisper ${res.status}` };
      const payload = (await res.json()) as { text?: string };
      return { ok: true, text: cleanTranscript(payload.text ?? '') };
    } catch (err) {
      return { ok: false, reason: `çözümleme başarısız: ${(err as Error).message}` };
    }
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
    this.port = 0;
  }
}

export type SpeakResult = { ok: true } | { ok: false; reason: string };

/** Server-side speech: SAPI. For Turkish the UI uses the browser voice. */
export function speak(
  text: string,
  opts: { voice?: string; rate?: number } = {},
): Promise<SpeakResult> {
  return speakSapi(text, opts);
}

export function ensureVoiceDirs(dataDir?: string): void {
  mkdirSync(join(voiceDir(dataDir), 'bin'), { recursive: true });
  mkdirSync(join(voiceDir(dataDir), 'models'), { recursive: true });
}

export function voiceSetupHint(dataDir?: string): string {
  return [
    'Yerel ses için:',
    '  npm run karen -- voice-setup --yes',
    `  binary: ${whisperBinaryCandidates(dataDir)[0]}`,
    `  model:  ${whisperModelCandidates(dataDir)[0]}`,
    'Türkçe seslendirme için Windows Ayarlar → Zaman ve Dil → Konuşma → Ses ekle (Türkçe).',
  ].join('\n');
}
