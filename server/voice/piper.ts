import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { piperBinary, voiceModel } from './assets.js';

export class VoiceEngineMissing extends Error {
  constructor() {
    super('voice engine is not installed');
    this.name = 'VoiceEngineMissing';
  }
}

/** Last N replies are kept in memory: the same sentence is said often. */
const CACHE_LIMIT = 50;
const cache = new Map<string, Buffer>();

export function voiceForLang(lang: 'tr-TR' | 'en-US', byLang: Record<'tr-TR' | 'en-US', string>): string {
  return byLang[lang] ?? (lang === 'tr-TR' ? 'tr_TR-dfki-medium' : 'en_GB-alba-medium');
}

/** Piper takes a length scale: larger is slower, so a faster voice needs a smaller one. */
export function lengthScale(speed: number): string {
  const safe = Number.isFinite(speed) && speed > 0 ? Math.min(1.3, Math.max(0.7, speed)) : 1;
  return (1 / safe).toFixed(3);
}

export type SynthOptions = {
  text: string;
  lang: 'tr-TR' | 'en-US';
  dataDir?: string;
  speed?: number;
  voice?: string;
  timeoutMs?: number;
  /** Test seam: replaces the real Piper process. */
  runImpl?: (binary: string, args: string[], input: string) => Promise<Buffer>;
};

/** Runs Piper once and returns whatever WAV it wrote to stdout. */
function runPiper(binary: string, args: string[], input: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`piper exited with ${code}: ${stderr.slice(-200)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input, 'utf8');
  });
}

/**
 * Synthesises speech locally. Throws `VoiceEngineMissing` when the engine or the voice
 * is not installed, so the caller can fall back instead of hanging.
 */
export async function synthesise(opts: SynthOptions): Promise<{ wav: Buffer; cached: boolean }> {
  const text = opts.text.trim().slice(0, 2000);
  if (text === '') throw new Error('nothing to say');

  const voice = opts.voice ?? voiceForLang(opts.lang, {
    'tr-TR': 'tr_TR-dfki-medium',
    'en-US': 'en_GB-alba-medium',
  } as Record<'tr-TR' | 'en-US', string>);
  const key = `${voice}|${lengthScale(opts.speed ?? 1)}|${text}`;

  const hit = cache.get(key);
  if (hit) return { wav: hit, cached: true };

  const binary = piperBinary(opts.dataDir);
  const model = voiceModel(opts.dataDir, voice);
  if (binary === null || model === null) throw new VoiceEngineMissing();

  const args = ['--model', model, '--output_file', '-', '--length_scale', lengthScale(opts.speed ?? 1)];
  const run = opts.runImpl ?? runPiper;

  const wav = await withTimeout(run(binary, args, text), opts.timeoutMs ?? 15_000);

  cache.set(key, wav);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return { wav, cached: false };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`speech timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Cache handles for tests and for the "clear" button. */
export function clearSpeechCache(): void {
  cache.clear();
}

export function speechCacheSize(): number {
  return cache.size;
}

/**
 * Plays a WAV on the default output device, server-side, so speech works with the
 * window closed. Returns false instead of throwing: a failed playback is not a crash.
 */
export function playWav(wav: Buffer, opts: { runImpl?: (script: string) => Promise<boolean> } = {}): Promise<boolean> {
  const run = opts.runImpl ?? runPowerShell;
  if (process.platform !== 'win32' && opts.runImpl === undefined) return Promise.resolve(false);

  const file = join(tmpdir(), `karen-speech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  try {
    writeFileSync(file, wav);
  } catch {
    return Promise.resolve(false);
  }

  const script = `$p = New-Object System.Media.SoundPlayer '${file.replace(/'/g, "''")}'; $p.PlaySync()`;
  return run(script).finally(() => {
    try {
      rmSync(file, { force: true });
    } catch {
      /* the temp file is cleaned by the OS eventually */
    }
  });
}

function runPowerShell(script: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.end();
  });
}

/** Creates the speech directories; safe to call repeatedly. */
export function ensureSpeechDirs(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
