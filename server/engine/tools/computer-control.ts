import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from './types.js';

/**
 * Direct computer control. One `powershell.exe` per action with inline C#: no native
 * helper to build, sign or supervise, and every action is bounded to two seconds.
 * Whether an action is allowed is decided by `computer-policy.ts`, not here.
 */
const TIMEOUT_MS = 2000;

export type ShellResult = { ok: boolean; stdout: string; stderr: string };
export type Runner = (script: string) => Promise<ShellResult>;

export const runPowerShell: Runner = (script) =>
  new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(script)], {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: ShellResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, stdout, stderr: 'timed out' });
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => finish({ ok: false, stdout, stderr: err.message }));
    child.on('close', (code) => finish({ ok: code === 0, stdout, stderr }));
    child.stdin.end();
  });

/** PowerShell -EncodedCommand takes UTF-16LE base64, which keeps Turkish text intact. */
export function encode(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

const PRELUDE = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION {
    [FieldOffset(0)] public MI mi;
    [FieldOffset(0)] public KI ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MI {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr extra;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KI {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extra;
  }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] i, int size);
}
'@
`;

/** Types text as Unicode scan codes, so Turkish letters arrive intact. */
export function typeTextScript(text: string): string {
  const safe = text.replace(/'/g, "''");
  return `${PRELUDE}
$text = '${safe}'
$size = [System.Runtime.InteropServices.Marshal]::SizeOf([type][K+INPUT])
foreach ($ch in $text.ToCharArray()) {
  $down = New-Object K+INPUT
  $down.type = 1
  $down.u.ki.wScan = [int]$ch
  $down.u.ki.dwFlags = 0x0004
  [void][K]::SendInput(1, @($down), $size)
  $up = $down
  $up.u.ki.dwFlags = 0x0006
  [void][K]::SendInput(1, @($up), $size)
  Start-Sleep -Milliseconds 8
}
Write-Output 'ok'
`;
}

export function mouseMoveScript(x: number, y: number): string {
  return `${PRELUDE}
[void][K]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
Write-Output 'ok'
`;
}

export function mouseClickScript(x: number, y: number, button: 'left' | 'right' | 'middle', count: number): string {
  const down = button === 'right' ? '0x0008' : button === 'middle' ? '0x0020' : '0x0002';
  const up = button === 'right' ? '0x0010' : button === 'middle' ? '0x0040' : '0x0004';
  return `${PRELUDE}
[void][K]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
Start-Sleep -Milliseconds 40
for ($i = 0; $i -lt ${Math.min(2, Math.max(1, Math.round(count)))}; $i++) {
  [K]::mouse_event(${down}, 0, 0, 0, [IntPtr]::Zero)
  [K]::mouse_event(${up}, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
}
Write-Output 'ok'
`;
}

/** Presses then releases; the release lives in `finally`, so a kill cannot leave a key held. */
export function pressKeysScript(combo: string): string {
  const codes = combo
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((key) => KEY_CODES[key])
    .filter((code): code is number => code !== undefined);
  const presses = codes.map((code) => `  [K]::keybd_event(${code}, 0, 0, [IntPtr]::Zero)`).join('\n');
  const releases = [...codes].reverse().map((code) => `  [K]::keybd_event(${code}, 0, 0x0002, [IntPtr]::Zero)`).join('\n');
  return `${PRELUDE}
try {
${presses}
  Start-Sleep -Milliseconds 40
} finally {
${releases}
}
Write-Output 'ok'
`;
}

export const KEY_CODES: Record<string, number> = {
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  shift: 0x10,
  win: 0x5b,
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  esc: 0x1b,
  escape: 0x1b,
  space: 0x20,
  backspace: 0x08,
  delete: 0x2e,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, 0x70 + i])),
  // Letters and digits are their ASCII codes as virtual keys: `ctrl+t` only works with this.
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [String.fromCharCode(97 + i), 0x41 + i])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), 0x30 + i])),
};

export function unknownKeyCombo(combo: string): string[] {
  return combo
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter((key) => key !== '' && KEY_CODES[key] === undefined);
}

export function windowListScript(): string {
  return `${PRELUDE}
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  $r = New-Object K+RECT
  [void][K]::GetWindowRect($_.MainWindowHandle, [ref]$r)
  '{0}|{1}|{2}|{3}|{4}|{5}' -f $_.Id, $_.ProcessName, $_.MainWindowTitle, $r.Left, $r.Top, ($r.Right - $r.Left)
}
`;
}

export function windowFocusScript(title: string): string {
  const safe = title.replace(/'/g, "''");
  return `${PRELUDE}
$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safe}*' } | Select-Object -First 1
if (-not $p) { Write-Output 'not-found'; exit 0 }
[void][K]::ShowWindow($p.MainWindowHandle, 9)
[void][K]::SetForegroundWindow($p.MainWindowHandle)
Write-Output 'ok'
`;
}

const isWindows = process.platform === 'win32';

/** Computer-control tools, or an empty list when the feature is off. */
export function computerControlTools(opts: { enabled: boolean; run?: Runner }): Tool[] {
  if (!opts.enabled) return [];
  const runner = opts.run ?? runPowerShell;

  const wrap = (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    access: 'read' | 'exec',
    build: (args: Record<string, unknown>) => string,
    validate?: (args: Record<string, unknown>) => string | null,
  ): Tool => ({
    access,
    def: { name, description, inputSchema },
    run: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const problem = validate?.(args) ?? null;
      if (problem !== null) return { ok: false, output: problem };
      if (!isWindows && opts.run === undefined) return { ok: false, output: 'windows only' };
      const result = await runner(build(args));
      if (!result.ok) {
        const detail = (result.stderr || result.stdout).trim().slice(0, 300);
        return { ok: false, output: `failed: ${detail || 'no output'}` };
      }
      return { ok: true, output: result.stdout.trim() || 'ok' };
    },
  });

  return [
    wrap('mouse_move', 'Move the mouse pointer to a screen coordinate.', {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    }, 'exec', (args) => mouseMoveScript(Number(args['x']), Number(args['y']))),

    wrap('mouse_click', 'Click the mouse at a screen coordinate.', {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        count: { type: 'number' },
      },
      required: ['x', 'y'],
    }, 'exec', (args) =>
      mouseClickScript(
        Number(args['x']),
        Number(args['y']),
        (args['button'] as 'left' | 'right' | 'middle') ?? 'left',
        Number(args['count'] ?? 1),
      )),

    wrap('scroll', 'Scroll the mouse wheel at the current pointer position.', {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    }, 'exec', (args) => `${PRELUDE}\n[K]::mouse_event(0x0800, 0, 0, ${Math.round(Number(args['amount'] ?? 0))}, [IntPtr]::Zero)\nWrite-Output 'ok'\n`),

    wrap('type_text', 'Type text into the focused window. Turkish characters are supported.', {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    }, 'exec', (args) => typeTextScript(String(args['text'] ?? ''))),

    wrap('press_keys', 'Press a key combination, for example ctrl+shift+t.', {
      type: 'object',
      properties: { keys: { type: 'string' } },
      required: ['keys'],
    }, 'exec', (args) => pressKeysScript(String(args['keys'] ?? '')), (args) => {
      const unknown = unknownKeyCombo(String(args['keys'] ?? ''));
      return unknown.length > 0 ? `unknown key: ${unknown.join(', ')}` : null;
    }),

    wrap('window_list', 'List windows with their process, title and position.', {
      type: 'object',
      properties: {},
    }, 'read', () => windowListScript()),

    wrap('window_focus', 'Bring a window to the front by part of its title.', {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    }, 'exec', (args) => windowFocusScript(String(args['title'] ?? ''))),
  ];
}
