import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool, ToolResult } from './types.js';

const isWindows = process.platform === 'win32';

function run(command: string, args: string[], timeoutMs = 20_000): Promise<ToolResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, output: `failed: ${err.message}\n${stderr ?? ''}`.trim() });
        else resolve({ ok: true, output: (stdout || stderr || 'ok').trim() });
      },
    );
  });
}

function powershell(script: string, timeoutMs = 20_000): Promise<ToolResult> {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], timeoutMs);
}

/** Screenshot folder: under the data folder, not temporary. */
export function screenshotDir(dataDir: string): string {
  const dir = join(dataDir, 'screenshots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function computerTools(opts: {
  dataDir: string;
  /** Permission boundary (cwd) of the folder the screenshot tool writes to. */
  cwd: string;
}): Tool[] {
  return [
    {
      access: 'exec',
      def: {
        name: 'open_app',
        description: 'Opens an application or file on the computer (e.g. notepad, chrome, C:\\path\\file.pdf).',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Application name or path' },
            args: { type: 'string', description: 'Extra arguments (optional)' },
          },
          required: ['name'],
        },
      },
      async run(args) {
        const name = typeof args['name'] === 'string' ? args['name'].trim() : '';
        if (name === '') return { ok: false, output: 'name required' };
        if (!isWindows) return { ok: false, output: 'Windows only' };
        const extra = typeof args['args'] === 'string' ? args['args'] : '';
        // PowerShell Start-Process: accepts a path or an application name.
        const safeName = name.replace(/'/g, "''");
        const safeArgs = extra.replace(/'/g, "''");
        const script = safeArgs
          ? `Start-Process -FilePath '${safeName}' -ArgumentList '${safeArgs}'`
          : `Start-Process '${safeName}'`;
        const result = await powershell(script, 20_000);
        return result.ok ? { ok: true, output: `opened: ${name}` } : result;
      },
    },
    {
      access: 'exec',
      def: {
        name: 'screenshot',
        description: 'Takes a screenshot and returns the file path. The image stays on the local disk.',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string', description: 'File name (optional)' } },
        },
      },
      async run(args) {
        if (!isWindows) return { ok: false, output: 'Windows only' };
        const dir = screenshotDir(opts.dataDir);
        const rawName = typeof args['name'] === 'string' ? args['name'] : `screen-${Date.now()}`;
        const name = rawName.replace(/[^\w.-]/g, '_').slice(0, 60);
        const file = join(dir, name.endsWith('.png') ? name : `${name}.png`);
        const script = [
          'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
          '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
          '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
          '$g = [System.Drawing.Graphics]::FromImage($bmp)',
          '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
          `$bmp.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
          '$g.Dispose(); $bmp.Dispose()',
        ].join('; ');
        const result = await powershell(script, 30_000);
        if (!result.ok) return result;
        if (!existsSync(file)) return { ok: false, output: 'image was not created' };
        const size = statSync(file).size;
        return { ok: true, output: `${file} (${Math.round(size / 1024)} KB)` };
      },
    },
    {
      access: 'exec',
      def: {
        name: 'clipboard_read',
        description: 'Reads the clipboard text. The clipboard may hold secrets; use only when needed.',
        inputSchema: { type: 'object', properties: {} },
      },
      async run() {
        if (!isWindows) return { ok: false, output: 'Windows only' };
        const result = await powershell('Get-Clipboard -Raw');
        return result.ok ? { ok: true, output: result.output.slice(0, 20_000) } : result;
      },
    },
    {
      access: 'write',
      def: {
        name: 'clipboard_write',
        description: 'Writes text to the clipboard.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Text to write to the clipboard' } },
          required: ['text'],
        },
      },
      async run(args) {
        if (!isWindows) return { ok: false, output: 'Windows only' };
        const text = typeof args['text'] === 'string' ? args['text'].slice(0, 100_000) : '';
        if (text === '') return { ok: false, output: 'text required' };
        return new Promise<ToolResult>((resolve) => {
          const proc = execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
            { timeout: 15_000, windowsHide: true },
            (err) => (err ? resolve({ ok: false, output: err.message }) : resolve({ ok: true, output: 'written to clipboard' })),
          );
          proc.stdin?.end(text);
        });
      },
    },
    {
      access: 'exec',
      def: {
        name: 'media_control',
        description: 'Media playback control: play_pause, next, previous, volume_up, volume_down, mute.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: 'play_pause | next | previous | volume_up | volume_down | mute',
            },
          },
          required: ['action'],
        },
      },
      async run(args) {
        if (!isWindows) return { ok: false, output: 'Windows only' };
        const action = String(args['action'] ?? '');
        const keys: Record<string, string> = {
          play_pause: '0xB3',
          next: '0xB0',
          previous: '0xB1',
          volume_up: '0xAF',
          volume_down: '0xAE',
          mute: '0xAD',
        };
        const code = keys[action];
        if (!code) return { ok: false, output: `unknown action: ${action}` };
        const script = [
          '$sig = "[DllImport(\\\\"user32.dll\\\\")] public static extern void keybd_event(byte b, byte c, uint d, int e);"',
          'Add-Type -MemberDefinition $sig -Name K -Namespace W',
          `[W.K]::keybd_event(${code},0,0,0)`,
          `[W.K]::keybd_event(${code},0,2,0)`,
        ].join('; ');
        const result = await powershell(script, 15_000);
        return result.ok ? { ok: true, output: `media: ${action}` } : result;
      },
    },
    {
      access: 'exec',
      def: {
        name: 'window_focus',
        description: 'Brings the window with the matching title to the front.',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string', description: 'Part of the window title' } },
          required: ['title'],
        },
      },
      async run(args) {
        if (!isWindows) return { ok: false, output: 'Windows only' };
        const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
        if (title === '') return { ok: false, output: 'title required' };
        const safe = title.replace(/'/g, "''");
        const script = [
          '$sig = "[DllImport(\\\\"user32.dll\\\\")] public static extern bool SetForegroundWindow(IntPtr h);"',
          'Add-Type -MemberDefinition $sig -Name W -Namespace Z',
          `$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safe}*' } | Select-Object -First 1`,
          'if ($p) { [Z.W]::SetForegroundWindow($p.MainWindowHandle); "focused: " + $p.MainWindowTitle } else { "window not found" }',
        ].join('; ');
        return powershell(script, 15_000);
      },
    },
  ];
}

/** Test helper: what is in which folder (for tool-list assertions). */
export function listScreenshots(dataDir: string): string[] {
  const dir = screenshotDir(dataDir);
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
