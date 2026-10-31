import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from './types.js';
import { truncate } from './types.js';

export const DEFAULT_TIMEOUT_MS = 120_000;
const CAPTURE_LIMIT = 256 * 1024;

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* process already dead */
      }
    }
  }
}

export function runCommandTool(cwd: string): Tool {
  return {
    access: 'exec',
    def: {
      name: 'run_command',
      description: 'Runs a shell command. On timeout the process tree is killed.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run' },
          timeoutMs: { type: 'number', description: `Default ${DEFAULT_TIMEOUT_MS}` },
        },
        required: ['command'],
      },
    },
    run(args, ctx): Promise<ToolResult> {
      const command = String(args['command'] ?? '');
      if (!command) return Promise.resolve({ ok: false, output: 'command required' });
      if (ctx.signal.aborted) return Promise.resolve({ ok: false, output: 'aborted' });
      const timeoutMs = typeof args['timeoutMs'] === 'number' ? args['timeoutMs'] : DEFAULT_TIMEOUT_MS;

      return new Promise<ToolResult>((resolve) => {
        let output = '';
        let settled = false;
        const finish = (result: ToolResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ctx.signal.removeEventListener('abort', onAbort);
          resolve({ ...result, output: truncate(result.output) });
        };

        const child = spawn(command, {
          cwd,
          shell: true,
          windowsHide: true,
          // On POSIX make it a process group leader so descendants die too.
          detached: process.platform !== 'win32',
        });
        const onAbort = () => {
          killTree(child.pid);
          finish({ ok: false, output: 'aborted' });
        };
        const timer = setTimeout(() => {
          killTree(child.pid);
          finish({ ok: false, output: `${output}\ntimeout after ${timeoutMs}ms` });
        }, timeoutMs);

        ctx.signal.addEventListener('abort', onAbort, { once: true });

        const collect = (chunk: Buffer) => {
          if (output.length < CAPTURE_LIMIT) output += chunk.toString('utf8');
        };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        child.on('error', (err) => finish({ ok: false, output: `spawn failed: ${err.message}` }));
        child.on('close', (code) => finish({ ok: code === 0, output: output.trimEnd() }));
      });
    },
  };
}
