import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ensureVoiceDirs, voiceDir, whisperBinaryCandidates, whisperModelCandidates } from './index.js';

const RELEASES_API = 'https://api.github.com/repos/ggerganov/whisper.cpp/releases?per_page=10';
const FALLBACK_BINARY_URL =
  'https://github.com/ggerganov/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip';
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
const MODEL_NAME = 'ggml-base.bin';

/**
 * Finds the Windows binary. A pinned release tag can disappear over time, so the
 * real asset URL is read from GitHub first; failing that, it falls back to a known version.
 */
async function resolveBinaryUrl(): Promise<string> {
  try {
    const response = await fetch(RELEASES_API, {
      headers: { 'user-agent': 'karen', accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return FALLBACK_BINARY_URL;
    const releases = (await response.json()) as {
      assets?: { name: string; browser_download_url: string }[];
    }[];
    for (const release of releases) {
      const asset = (release.assets ?? []).find((a) => a.name === 'whisper-bin-x64.zip');
      if (asset) return asset.browser_download_url;
    }
  } catch {
    /* no network: fall back to the backup */
  }
  return FALLBACK_BINARY_URL;
}

export type SetupResult = { ok: boolean; steps: string[] };

async function download(url: string, target: string, onProgress?: (mb: number) => void): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${url}`);
  const part = `${target}.part`;
  let received = 0;
  let lastReport = 0;
  const stream = Readable.fromWeb(response.body as never);
  stream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    const mb = Math.round(received / 1_048_576);
    if (mb !== lastReport) {
      lastReport = mb;
      onProgress?.(mb);
    }
  });
  await pipeline(stream, createWriteStream(part));
  renameSync(part, target);
}

function unzip(zip: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // On Windows, PowerShell Expand-Archive exists on every machine.
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`,
      ],
      { timeout: 180_000, windowsHide: true },
      (err) => (err ? reject(new Error(`extraction failed: ${err.message}`)) : resolve()),
    );
  });
}

function findFile(dir: string, names: string[]): string | null {
  for (const name of names) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Local voice setup: downloads the whisper binary + model. It does not run without
 * user consent (`--yes` is required). The download is ~150 MB; audio data never goes to the cloud.
 */
export async function setupVoice(opts: {
  dataDir?: string;
  consent: boolean;
  onProgress?: (message: string) => void;
  binaryUrl?: string;
  modelUrl?: string;
}): Promise<SetupResult> {
  const steps: string[] = [];
  if (!opts.consent) {
    return { ok: false, steps: ['approval needed: `karen voice-setup --yes` (downloads about 150 MB)'] };
  }
  if (process.platform !== 'win32') {
    return { ok: false, steps: ['voice-setup is Windows-only for now'] };
  }

  ensureVoiceDirs(opts.dataDir);
  const dir = voiceDir(opts.dataDir);
  const binDir = join(dir, 'bin');
  const modelDir = join(dir, 'models');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(modelDir, { recursive: true });

  // 1) Binary
  if (findFile(binDir, ['whisper-cli.exe', 'whisper.exe', 'main.exe'])) {
    steps.push('binary already installed');
  } else {
    const zip = join(dir, 'whisper-bin.zip');
    opts.onProgress?.('downloading the whisper binary…');
    const binaryUrl = opts.binaryUrl ?? (await resolveBinaryUrl());
    await download(binaryUrl, zip);
    opts.onProgress?.('extracting the archive…');
    await unzip(zip, binDir);
    rmSync(zip, { force: true });
    const found = whisperBinaryCandidates(opts.dataDir).find((p) => existsSync(p));
    if (!found) return { ok: false, steps: [...steps, 'the binary was not in the archive'] };
    steps.push(`binary installed: ${found}`);
  }

  // 2) Model
  if (findFile(modelDir, ['ggml-base.bin', 'ggml-small.bin', 'ggml-tiny.bin'])) {
    steps.push('model already installed');
  } else {
    const target = join(modelDir, MODEL_NAME);
    opts.onProgress?.('downloading the model (~142 MB)…');
    await download(opts.modelUrl ?? MODEL_URL, target, (mb) => opts.onProgress?.(`model: ${mb} MB`));
    steps.push(`model installed: ${target}`);
  }

  const binary = whisperBinaryCandidates(opts.dataDir).find((p) => existsSync(p)) ?? null;
  const model = whisperModelCandidates(opts.dataDir).find((p) => existsSync(p)) ?? null;
  if (!binary || !model) return { ok: false, steps: [...steps, 'setup did not complete'] };

  steps.push('ready');
  return { ok: true, steps };
}

export function voiceSetupHint(dataDir?: string): string {
  return [
    'For local voice:',
    '  npm run karen -- voice-setup --yes',
    `  binary: ${whisperBinaryCandidates(dataDir)[0]}`,
    `  model:  ${whisperModelCandidates(dataDir)[0]}`,
    'Speech output uses your OS voices; install more under Windows Settings → Time and Language → Speech.',
  ].join('\n');
}
