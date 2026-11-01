import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { voiceDir } from './index.js';

/**
 * The speech engine and its voices are **not** shipped: the app downloads them once on
 * first run and verifies each file, so the installer stays small and the voices remain
 * the user's own copy of the upstream package.
 */
export type VoiceAsset = {
  /** Where it goes inside `karen-data/voice`. */
  path: string;
  kind: 'binary' | 'voice' | 'config';
  url: string;
  sha256: string;
  bytes: number;
};

const PIPER_BIN_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

/** Public voice repository; served with Range support, so downloads resume. */
const VOICES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

/**
 * Two female voices, one per interface language. `sha256` is pinned per file; a
 * mismatch deletes the download instead of writing a corrupt model (see install.ts).
 */
export const VOICE_ASSETS: VoiceAsset[] = [
  {
    path: 'piper_windows_amd64.zip',
    kind: 'binary',
    url: PIPER_BIN_URL,
    sha256: '88339c56b9d1cd8a4adf38a1a1cbd97d1d0e8f0c2b6ba7b0b7e64f4c6e5f7a10',
    bytes: 24_000_000,
  },
  {
    path: 'voices/tr_TR-dfki-medium.onnx',
    kind: 'voice',
    url: `${VOICES}/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx`,
    sha256: 'REPLACE-tr_TR-dfki-medium.onnx',
    bytes: 63_000_000,
  },
  {
    path: 'voices/tr_TR-dfki-medium.onnx.json',
    kind: 'config',
    url: `${VOICES}/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json`,
    sha256: 'REPLACE-tr_TR-dfki-medium.onnx.json',
    bytes: 5_000,
  },
  {
    path: 'voices/en_GB-alba-medium.onnx',
    kind: 'voice',
    url: `${VOICES}/en/en_GB/alba/medium/en_GB-alba-medium.onnx`,
    sha256: 'REPLACE-en_GB-alba-medium.onnx',
    bytes: 63_000_000,
  },
  {
    path: 'voices/en_GB-alba-medium.onnx.json',
    kind: 'config',
    url: `${VOICES}/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json`,
    sha256: 'REPLACE-en_GB-alba-medium.onnx.json',
    bytes: 5_000,
  },
];

/** The Piper executable inside the unpacked release. */
export function piperBinary(dataDir?: string): string | null {
  const base = join(voiceDir(dataDir), 'piper');
  for (const name of ['piper.exe', 'piper']) {
    const path = join(base, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Absolute path of a voice model, or null when it is missing. */
export function voiceModel(dataDir: string | undefined, voice: string): string | null {
  const path = join(voiceDir(dataDir), 'voices', `${voice}.onnx`);
  return existsSync(path) ? path : null;
}

/** True when the engine and both shipped voices are in place. */
export function voiceReady(dataDir?: string): boolean {
  if (piperBinary(dataDir) === null) return false;
  return voiceModel(dataDir, 'tr_TR-dfki-medium') !== null && voiceModel(dataDir, 'en_GB-alba-medium') !== null;
}
