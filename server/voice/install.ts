import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { VOICE_ASSETS, type VoiceAsset } from './assets.js';
import { voiceDir } from './index.js';

export type InstallPhase = 'missing' | 'downloading' | 'verifying' | 'ready' | 'failed';

export type InstallState = {
  phase: InstallPhase;
  /** File currently being fetched, for the progress line. */
  file?: string;
  received?: number;
  total?: number;
  error?: string;
};

export type InstallOptions = {
  dataDir?: string;
  onProgress?: (state: InstallState) => void;
  fetchImpl?: typeof fetch;
  assets?: VoiceAsset[];
  /** Test seam: skip the hash check for fixtures that are not the real files. */
  verify?: boolean;
};

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Downloads and verifies the speech engine and its voices. Resumable (`.part` files are
 * kept), idempotent (a complete tree is not touched), and never throws: every failure
 * comes back as `{ phase: 'failed', error }` with the completed files left in place.
 */
export async function installVoiceAssets(opts: InstallOptions = {}): Promise<InstallState> {
  const root = voiceDir(opts.dataDir);
  const assets = opts.assets ?? VOICE_ASSETS;
  const doFetch = opts.fetchImpl ?? fetch;
  const verify = opts.verify ?? true;
  const progress = (state: InstallState): InstallState => {
    opts.onProgress?.(state);
    return state;
  };

  for (const asset of assets) {
    const target = join(root, asset.path);
    if (existsSync(target)) continue;

    const part = `${target}.part`;
    mkdirSync(dirname(target), { recursive: true });

    try {
      progress({ phase: 'downloading', file: asset.path, received: 0, total: asset.bytes });
      const buffer = await download(doFetch, asset.url, part, (received) =>
        progress({ phase: 'downloading', file: asset.path, received, total: asset.bytes }),
      );

      progress({ phase: 'verifying', file: asset.path });
      if (verify && !/^REPLACE/.test(asset.sha256) && sha256(buffer) !== asset.sha256) {
        // One retry: a truncated download is the common cause, a corrupted mirror the rare one.
        rmSync(part, { force: true });
        const again = await download(doFetch, asset.url, part, () => undefined);
        if (sha256(again) !== asset.sha256) {
          rmSync(part, { force: true });
          return progress({ phase: 'failed', file: asset.path, error: `checksum mismatch for ${asset.path}` });
        }
        renameSync(part, target);
        continue;
      }

      renameSync(part, target);
    } catch (err) {
      return progress({
        phase: 'failed',
        file: asset.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return progress({ phase: 'ready' });
}

/** Fetches into `<target>.part`, continuing from whatever is already there. */
async function download(
  doFetch: typeof fetch,
  url: string,
  part: string,
  onProgress: (received: number) => void,
): Promise<Buffer> {
  const already = existsSync(part) ? statSync(part).size : 0;
  const headers: Record<string, string> = {};
  if (already > 0) headers['range'] = `bytes=${already}-`;

  const response = await doFetch(url, { headers });
  if (!response.ok && response.status !== 206) {
    throw new Error(`${url} answered ${response.status}`);
  }

  const chunks: Buffer[] = [];
  const reader = response.body?.getReader();
  let received = already;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(Buffer.from(value));
        received += value.length;
        onProgress(received);
      }
    }
  } else {
    const whole = Buffer.from(await response.arrayBuffer());
    chunks.push(whole);
    received += whole.length;
    onProgress(received);
  }

  const fresh = Buffer.concat(chunks);
  // A resumed download is appended to the partial body.
  const body = already > 0 ? Buffer.concat([readFileSync(part), fresh]) : fresh;
  writeFileSync(part, body);
  return body;
}
