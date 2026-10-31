import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommandTool } from '../../server/engine/tools/shell.js';
import { allTools } from '../../server/engine/tools/index.js';

const ctx = (cwd: string, signal = new AbortController().signal) => ({ cwd, signal });

describe('run_command', () => {
  it('returns output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await runCommandTool(dir).run({ command: 'node -e "console.log(21*2)"' }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(r.output.trim()).toBe('42');
  });

  it('kills on timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await runCommandTool(dir).run({ command: 'node -e "setTimeout(()=>{},60000)"', timeoutMs: 300 }, ctx(dir));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('timeout');
  });

  it('the command does not run when cancelled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const ac = new AbortController();
    ac.abort();
    const r = await runCommandTool(dir).run({ command: 'node -e "console.log(1)"' }, ctx(dir, ac.signal));
    expect(r.ok).toBe(false);
    expect(r.output).toBe('aborted');
  });

  it('allTools includes the exec tools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const names = allTools(dir).map((t) => t.def.name);
    expect(names).toContain('run_command');
    expect(names).toContain('fetch_url');
  });
});
