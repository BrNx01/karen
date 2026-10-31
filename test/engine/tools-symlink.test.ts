import { describe, it, expect } from 'vitest';
import { symlinkSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTools, writeTools } from '../../server/engine/tools/index.js';

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal });
const find = (cwd: string, name: string) => readTools(cwd).concat(writeTools(cwd)).find((t) => t.def.name === name)!;

describe('symlink protection', () => {
  it('does not write outside the root through a link', async () => {
    const root = mkdtempSync(join(tmpdir(), 'karen-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'karen-out-'));
    try {
      symlinkSync(outside, join(root, 'link'), 'junction');
    } catch {
      return; // bağ kurulamıyorsa (yetki) test atlanır
    }
    const r = await find(root, 'write_file').run({ path: 'link/pwn.txt', content: 'x' }, ctx(root));
    expect(r.ok).toBe(false);
    expect(existsSync(join(outside, 'pwn.txt'))).toBe(false);
  });

  it('does not read outside the root through a link', async () => {
    const root = mkdtempSync(join(tmpdir(), 'karen-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'karen-out-'));
    writeFileSync(join(outside, 'secret.txt'), 'gizli');
    try {
      symlinkSync(outside, join(root, 'link'), 'junction');
    } catch {
      return;
    }
    const r = await find(root, 'read_file').run({ path: 'link/secret.txt' }, ctx(root));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('outside cwd');
  });
});
