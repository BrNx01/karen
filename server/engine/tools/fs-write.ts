import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as nodePath from 'node:path';
import type { Tool, ToolResult } from './types.js';
import { outsideCwd, resolveInside } from './types.js';

/** Symlink resolution happens inside `resolveInside`; here it is only wrapped. */
async function guardReal(cwd: string, path: string): Promise<string | ToolResult> {
  const target = resolveInside(cwd, path);
  if (!target) return outsideCwd(path);
  return target;
}

export function writeTools(cwd: string): Tool[] {
  return [
    {
      access: 'write',
      def: {
        name: 'write_file',
        description: 'Rewrites a file from scratch; creates parent directories.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'path relative to cwd' },
            content: { type: 'string', description: 'Full file content' },
          },
          required: ['path', 'content'],
        },
      },
      async run(args): Promise<ToolResult> {
        const path = String(args['path'] ?? '');
        const target = await guardReal(cwd, path);
        if (typeof target !== 'string') return target;
        try {
          await mkdir(nodePath.dirname(target), { recursive: true });
          await writeFile(target, String(args['content'] ?? ''), 'utf8');
          return { ok: true, output: `wrote ${path}` };
        } catch (err) {
          return { ok: false, output: `write failed: ${(err as Error).message}` };
        }
      },
    },
    {
      access: 'write',
      def: {
        name: 'edit_file',
        description: 'Replaces the place where oldString occurs in the file with newString. The match must be unique.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'path relative to cwd' },
            oldString: { type: 'string', description: 'Exact text to find' },
            newString: { type: 'string', description: 'Replacement text' },
            replaceAll: { type: 'boolean', description: 'Replace all matches' },
          },
          required: ['path', 'oldString', 'newString'],
        },
      },
      async run(args): Promise<ToolResult> {
        const path = String(args['path'] ?? '');
        const target = await guardReal(cwd, path);
        if (typeof target !== 'string') return target;
        const oldString = String(args['oldString'] ?? '');
        const newString = String(args['newString'] ?? '');
        if (!oldString) return { ok: false, output: 'oldString required' };
        if (oldString === newString) return { ok: false, output: 'oldString and newString are identical' };
        try {
          const text = await readFile(target, 'utf8');
          const count = text.split(oldString).length - 1;
          if (count === 0) return { ok: false, output: 'oldString not found' };
          if (count > 1 && args['replaceAll'] !== true) {
            return { ok: false, output: `multiple matches (${count}); add more context or set replaceAll` };
          }
          const next =
            args['replaceAll'] === true
              ? text.split(oldString).join(newString)
              : text.replace(oldString, () => newString);
          await writeFile(target, next, 'utf8');
          return { ok: true, output: `edited ${path} (${args['replaceAll'] === true ? count : 1} replacement)` };
        } catch (err) {
          return { ok: false, output: `edit failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
