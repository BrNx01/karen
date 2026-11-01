import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installVoiceAssets } from '../server/voice/install.js';
import { lengthScale, clearSpeechCache, speechCacheSize, synthesise, VoiceEngineMissing } from '../server/voice/piper.js';
import { voiceReady } from '../server/voice/assets.js';
import type { VoiceAsset } from '../server/voice/assets.js';

const dir = () => mkdtempSync(join(tmpdir(), 'karen-voice-'));

/** A fetch that serves `body` and records the Range header it was asked for. */
function serving(body: Buffer, seen: { range?: string; count: number } = { count: 0 }): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    seen.count++;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.range = headers['range'];
    return new Response(new Uint8Array(body), { status: 200 });
  }) as unknown as typeof fetch;
}

function assetsFor(contents: { path: string; body: Buffer }[]): VoiceAsset[] {
  return contents.map((item) => ({ path: item.path, kind: 'voice', url: `https://x/${item.path}`, sha256: 'REPLACE', bytes: item.body.length }));
}

describe('installVoiceAssets', () => {
  it('downloads every asset and reports ready', async () => {
    const root = dir();
    const a = Buffer.from('voice-a');
    const b = Buffer.from('voice-b');
    const states: string[] = [];
    const result = await installVoiceAssets({
      dataDir: root,
      assets: assetsFor([{ path: 'voices/a.onnx', body: a }, { path: 'voices/b.onnx', body: b }]),
      fetchImpl: serving(a),
      onProgress: (s) => states.push(s.phase),
      verify: false,
    });
    expect(result.phase).toBe('ready');
    expect(states).toContain('downloading');
    expect(states).toContain('verifying');
  });

  it('skips an already complete tree without a request', async () => {
    const root = dir();
    mkdirSync(join(root, 'voice', 'voices'), { recursive: true });
    writeFileSync(join(root, 'voice', 'voices', 'a.onnx'), 'done');
    const seen = { count: 0 };
    const result = await installVoiceAssets({
      dataDir: root,
      assets: assetsFor([{ path: 'voices/a.onnx', body: Buffer.from('x') }]),
      fetchImpl: serving(Buffer.from('x'), seen),
      verify: false,
    });
    expect(result.phase).toBe('ready');
    expect(seen.count).toBe(0);
  });

  it('resumes from a partial file with a Range header', async () => {
    const root = dir();
    mkdirSync(join(root, 'voice', 'voices'), { recursive: true });
    writeFileSync(join(root, 'voice', 'voices', 'a.onnx.part'), 'head-');
    const seen = { range: undefined as string | undefined, count: 0 };
    await installVoiceAssets({
      dataDir: root,
      assets: assetsFor([{ path: 'voices/a.onnx', body: Buffer.from('head-tail') }]),
      fetchImpl: serving(Buffer.from('tail'), seen),
      verify: false,
    });
    expect(seen.range).toBe('bytes=5-');
    expect(readFileSync(join(root, 'voice', 'voices', 'a.onnx'), 'utf8')).toBe('head-tail');
  });

  it('fails on a checksum mismatch and leaves no half file in place', async () => {
    const root = dir();
    const body = Buffer.from('wrong');
    const result = await installVoiceAssets({
      dataDir: root,
      assets: [{ path: 'voices/a.onnx', kind: 'voice', url: 'https://x/a', sha256: 'f'.repeat(64), bytes: body.length }],
      fetchImpl: serving(body),
    });
    expect(result.phase).toBe('failed');
    expect(result.error).toContain('checksum');
    expect(existsSync(join(root, 'voice', 'voices', 'a.onnx'))).toBe(false);
  });

  it('reports a network failure without throwing', async () => {
    const root = dir();
    const result = await installVoiceAssets({
      dataDir: root,
      assets: [{ path: 'voices/a.onnx', kind: 'voice', url: 'https://x/a', sha256: 'REPLACE', bytes: 1 }],
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    expect(result.phase).toBe('failed');
    expect(result.error).toContain('offline');
  });

  it('never reports ready when an asset is missing', () => {
    expect(voiceReady(dir())).toBe(false);
  });
});

describe('piper', () => {
  beforeEach(() => clearSpeechCache());

  it('maps speed onto Piper length scale', () => {
    expect(lengthScale(1)).toBe('1.000');
    expect(lengthScale(2)).toBe('0.769'); // clamped to 1.3
    expect(lengthScale(0.5)).toBe('1.429'); // clamped to 0.7
  });

  it('caches the same sentence', async () => {
    const root = dir();
    mkdirSync(join(root, 'voice', 'piper'), { recursive: true });
    mkdirSync(join(root, 'voice', 'voices'), { recursive: true });
    writeFileSync(join(root, 'voice', 'piper', 'piper.exe'), '');
    writeFileSync(join(root, 'voice', 'voices', 'tr_TR-dfki-medium.onnx'), '');
    const wav = Buffer.from('RIFF....WAVE');
    const first = await synthesise({ text: 'merhaba', lang: 'tr-TR', dataDir: root, runImpl: async () => wav });
    const second = await synthesise({ text: 'merhaba', lang: 'tr-TR', dataDir: root, runImpl: async () => wav });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(speechCacheSize()).toBe(1);
  });

  it('evicts the oldest entry past the limit', async () => {
    const root = dir();
    mkdirSync(join(root, 'voice', 'piper'), { recursive: true });
    mkdirSync(join(root, 'voice', 'voices'), { recursive: true });
    writeFileSync(join(root, 'voice', 'piper', 'piper.exe'), '');
    writeFileSync(join(root, 'voice', 'voices', 'tr_TR-dfki-medium.onnx'), '');
    for (let i = 0; i < 51; i++) {
      await synthesise({ text: `line ${i}`, lang: 'tr-TR', dataDir: root, runImpl: async () => Buffer.from('wav') });
    }
    expect(speechCacheSize()).toBe(50);
  });

  it('refuses when the engine is not installed', async () => {
    await expect(synthesise({ text: 'hi', lang: 'en-US', dataDir: dir() })).rejects.toBeInstanceOf(VoiceEngineMissing);
  });

  it('rejects empty text', async () => {
    await expect(synthesise({ text: '   ', lang: 'en-US', dataDir: dir() })).rejects.toThrow('nothing to say');
  });

  it('propagates a failed run', async () => {
    const root = dir();
    mkdirSync(join(root, 'voice', 'piper'), { recursive: true });
    mkdirSync(join(root, 'voice', 'voices'), { recursive: true });
    writeFileSync(join(root, 'voice', 'piper', 'piper.exe'), '');
    writeFileSync(join(root, 'voice', 'voices', 'en_GB-alba-medium.onnx'), '');
    await expect(
      synthesise({
        text: 'hi',
        lang: 'en-US',
        dataDir: root,
        runImpl: async () => {
          throw new Error('piper exited with 1');
        },
      }),
    ).rejects.toThrow('piper exited');
  });
});
