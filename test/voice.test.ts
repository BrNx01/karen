import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanTranscript, detectVoice, isWav, LocalWhisper, voiceDir } from '../server/voice/index.js';

describe('cleanTranscript', () => {
  it('strips timestamps and blank lines', () => {
    expect(
      cleanTranscript('[00:00:00.000 --> 00:00:02.000]  merhaba\n\n[00:00:02.000 --> 00:00:04.000]  nasılsın\n'),
    ).toBe('merhaba nasılsın');
  });

  it('returns empty text for empty output', () => {
    expect(cleanTranscript('')).toBe('');
  });
});

describe('isWav', () => {
  it('recognises a real WAV header', () => {
    const header = new Uint8Array(48);
    header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    header.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    expect(isWav(header)).toBe(true);
  });

  it('webm verisini reddeder', () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isWav(webm)).toBe(false);
  });
});

describe('detectVoice', () => {
  it('unavailable without a binary', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-voice-'));
    const info = await detectVoice(dataDir);
    expect(info.status).toBe('unavailable');
    expect(info.whisper.binary).toBeNull();
  });

  it('no-model when the binary exists but the model is missing', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-voice-'));
    mkdirSync(join(voiceDir(dataDir), 'bin'), { recursive: true });
    writeFileSync(join(voiceDir(dataDir), 'bin', process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'), 'x');
    const info = await detectVoice(dataDir);
    expect(info.status).toBe('no-model');
  });

  it('ready with a binary and a model', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-voice-'));
    mkdirSync(join(voiceDir(dataDir), 'bin'), { recursive: true });
    mkdirSync(join(voiceDir(dataDir), 'models'), { recursive: true });
    writeFileSync(join(voiceDir(dataDir), 'bin', process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'), 'x');
    writeFileSync(join(voiceDir(dataDir), 'models', 'ggml-base.bin'), 'x');
    expect((await detectVoice(dataDir)).status).toBe('ready');
  });
});

describe('LocalWhisper', () => {
  it('returns a clear reason when not installed', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'karen-voice-'));
    const whisper = new LocalWhisper({ dataDir, startupTimeoutMs: 1000 });
    const result = await whisper.transcribe(new Uint8Array(48), 'tr');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('whisper kurulu değil');
    whisper.stop();
  });
});
