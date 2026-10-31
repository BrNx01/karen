import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTools, truncate, MAX_OUTPUT } from '../../server/engine/tools/index.js';

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal });
const find = (cwd: string, name: string) => readTools(cwd).find((t) => t.def.name === name)!;

describe('read tools', () => {
  it('reads a file by line range', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    writeFileSync(join(dir, 'a.txt'), 'bir\niki\nüç\n');
    const r = await find(dir, 'read_file').run({ path: 'a.txt', offset: 2, limit: 1 }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(r.output).toBe('iki');
  });

  it('rejects a path outside cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await find(dir, 'read_file').run({ path: '../../../etc/passwd' }, ctx(dir));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('outside cwd');
  });

  it('limits output and reports truncation', async () => {
    expect(truncate('a'.repeat(MAX_OUTPUT + 10)).endsWith('…[truncated 10 bytes]')).toBe(true);
  });
});
