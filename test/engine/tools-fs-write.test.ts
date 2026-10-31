import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTools } from '../../server/engine/tools/index.js';

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal });
const find = (cwd: string, name: string) => writeTools(cwd).find((t) => t.def.name === name)!;

describe('write tools', () => {
  it('dosya yazar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await find(dir, 'write_file').run({ path: 'x.txt', content: 'merhaba' }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'x.txt'), 'utf8')).toBe('merhaba');
  });

  it('does not write outside cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await find(dir, 'write_file').run({ path: '../../kacak.txt', content: 'x' }, ctx(dir));
    expect(r.ok).toBe(false);
  });

  it('edit rejects multiple matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    await find(dir, 'write_file').run({ path: 'x.txt', content: 'aa\naa\n' }, ctx(dir));
    const r = await find(dir, 'edit_file').run({ path: 'x.txt', oldString: 'aa', newString: 'bb' }, ctx(dir));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('multiple');
  });

  it('yeni metindeki $& yorumlanmaz', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    await find(dir, 'write_file').run({ path: 'x.txt', content: 'NAME\n' }, ctx(dir));
    const r = await find(dir, 'edit_file').run({ path: 'x.txt', oldString: 'NAME', newString: '$&' }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'x.txt'), 'utf8')).toBe('$&\n');
  });
});
