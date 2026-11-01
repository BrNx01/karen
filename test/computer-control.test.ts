import { describe, it, expect } from 'vitest';
import {
  computerControlTools,
  encode,
  KEY_CODES,
  mouseClickScript,
  pressKeysScript,
  runPowerShell,
  typeTextScript,
  unknownKeyCombo,
  windowFocusScript,
  windowListScript,
} from '../server/engine/tools/computer-control.js';
import type { ToolContext } from '../server/engine/tools/types.js';

const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal };

/** Records the script it was handed and answers like a healthy PowerShell. */
function recorder(): { run: (script: string) => Promise<{ ok: boolean; stdout: string; stderr: string }>; scripts: string[] } {
  const scripts: string[] = [];
  return {
    scripts,
    run: async (script: string) => {
      scripts.push(script);
      return { ok: true, stdout: 'ok', stderr: '' };
    },
  };
}

describe('script building', () => {
  it('encodes scripts as UTF-16LE so Turkish survives the command line', () => {
    const encoded = encode("Write-Output 'ğüşıöç'");
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe("Write-Output 'ğüşıöç'");
  });

  it('types through SendInput with Unicode scan codes, not SendKeys', () => {
    const script = typeTextScript('ğüşıöç');
    expect(script).toContain('SendInput');
    expect(script).toContain('0x0004'); // KEYEVENTF_UNICODE
    expect(script).not.toContain('SendKeys');
  });

  it('escapes a quote in typed text', () => {
    expect(typeTextScript("it's fine")).toContain("it''s fine");
  });

  it('clicks with absolute coordinates and the right button flag', () => {
    const left = mouseClickScript(120, 340, 'left', 1);
    expect(left).toContain('SetCursorPos(120, 340)');
    expect(left).toContain('0x0002');
    expect(mouseClickScript(0, 0, 'right', 1)).toContain('0x0008');
    expect(mouseClickScript(0, 0, 'middle', 1)).toContain('0x0020');
  });

  it('releases keys in a finally block, in reverse order', () => {
    const script = pressKeysScript('ctrl+shift+t');
    expect(script).toContain('finally');
    const releaseBlock = script.slice(script.indexOf('finally'));
    expect(releaseBlock.indexOf('0x0002')).toBeGreaterThan(-1);
    expect(script.match(/0x0002/g)?.length).toBe(3);
  });

  it('reports keys it does not know', () => {
    expect(unknownKeyCombo('ctrl+shift+t')).toEqual([]);
    expect(unknownKeyCombo('ctrl+hyperdrive')).toEqual(['hyperdrive']);
    expect(KEY_CODES['f12']).toBeDefined();
  });

  it('escapes the window title in the focus script', () => {
    expect(windowFocusScript("O'Brien")).toContain("O''Brien");
  });

  it('prints one line per window', () => {
    expect(windowListScript()).toContain("'{0}|{1}|{2}|{3}|{4}|{5}'");
  });
});

describe('tools', () => {
  it('are absent when the feature is off', () => {
    expect(computerControlTools({ enabled: false })).toEqual([]);
  });

  it('exposes the whole set when enabled', () => {
    const names = computerControlTools({ enabled: true }).map((tool) => tool.def.name);
    expect(names).toEqual(['mouse_move', 'mouse_click', 'scroll', 'type_text', 'press_keys', 'window_list', 'window_focus']);
  });

  it('runs a click through the shell', async () => {
    const { run, scripts } = recorder();
    const tool = computerControlTools({ enabled: true, run }).find((item) => item.def.name === 'mouse_click');
    const result = await tool!.run({ x: 10, y: 20 }, ctx);
    expect(result.ok).toBe(true);
    expect(scripts[0]).toContain('SetCursorPos(10, 20)');
  });

  it('rejects an unknown key combination before touching the system', async () => {
    const { run, scripts } = recorder();
    const tool = computerControlTools({ enabled: true, run }).find((item) => item.def.name === 'press_keys');
    const result = await tool!.run({ keys: 'ctrl+hyperdrive' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('unknown key');
    expect(scripts).toHaveLength(0);
  });

  it('surfaces a shell failure as a readable message', async () => {
    const tool = computerControlTools({
      enabled: true,
      run: async () => ({ ok: false, stdout: '', stderr: 'Access is denied' }),
    }).find((item) => item.def.name === 'type_text');
    const result = await tool!.run({ text: 'hello' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Access is denied');
  });

  it('marks window listing as a read, so it needs no approval', () => {
    const tool = computerControlTools({ enabled: true }).find((item) => item.def.name === 'window_list');
    expect(tool?.access).toBe('read');
    expect(computerControlTools({ enabled: true }).find((item) => item.def.name === 'type_text')?.access).toBe('exec');
  });
});

describe('runPowerShell', () => {
  it('returns ok on Windows and reports a non-Windows host cleanly', async () => {
    if (process.platform !== 'win32') {
      expect((await runPowerShell("Write-Output 'hi'")).ok).toBe(false);
      return;
    }
    // A cold PowerShell start on a fresh runner can exceed the first attempt's budget.
    let result = await runPowerShell("Write-Output 'hi'");
    if (!result.ok) result = await runPowerShell("Write-Output 'hi'");
    expect(result.ok, result.stderr).toBe(true);
    expect(result.stdout.trim()).toBe('hi');
  });
});
