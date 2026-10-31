import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computerTools, screenshotDir } from '../server/engine/tools/computer.js';
import { classify } from '../server/engine/permissions.js';

const dataDir = () => mkdtempSync(join(tmpdir(), 'karen-computer-'));
const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal });

describe('computer tools', () => {
  it('registers the expected tools', () => {
    const tools = computerTools({ dataDir: dataDir(), cwd: '.' });
    const names = tools.map((t) => t.def.name);
    expect(names).toEqual([
      'open_app',
      'screenshot',
      'clipboard_read',
      'clipboard_write',
      'media_control',
      'window_focus',
    ]);
  });

  it('opens the screenshot folder inside the data folder', () => {
    const dir = dataDir();
    const shots = screenshotDir(dir);
    expect(shots.startsWith(dir)).toBe(true);
  });

  it('dangerous tools require approval', () => {
    const dir = 'C:\\work\\proj';
    const important = ['open_app', 'screenshot', 'clipboard_read', 'media_control', 'window_focus'];
    for (const tool of important) {
      expect(classify({ tool, access: 'exec', args: { name: 'x', title: 'x', action: 'mute' }, cwd: dir }).class).toBe(
        'important',
      );
    }
    // a write tool without a path cannot count as inside the root: clipboard writes need approval too.
    expect(classify({ tool: 'clipboard_write', access: 'write', args: { text: 'y' }, cwd: dir }).class).toBe('important');
  });

  it('rejects empty parameters', async () => {
    const tools = computerTools({ dataDir: dataDir(), cwd: '.' });
    const find = (name: string) => tools.find((t) => t.def.name === name)!;
    expect((await find('open_app').run({}, ctx('.'))).ok).toBe(false);
    expect((await find('clipboard_write').run({ text: '' }, ctx('.'))).ok).toBe(false);
    expect((await find('media_control').run({ action: 'uçur' }, ctx('.'))).ok).toBe(false);
    expect((await find('window_focus').run({}, ctx('.'))).ok).toBe(false);
  });

  it('an unknown media action is listed', async () => {
    const tools = computerTools({ dataDir: dataDir(), cwd: '.' });
    const media = tools.find((t) => t.def.name === 'media_control')!;
    const result = await media.run({ action: 'yok' }, ctx('.'));
    expect(result.output).toContain('bilinmeyen işlem');
  });
});
