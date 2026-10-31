import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as nodePath from 'node:path';
import type { Tool, ToolContext, ToolResult } from './types.js';
import { outsideCwd, resolveInside, truncate } from './types.js';

// Legacy project dirs stay invisible too.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.karen',
  '.zero', // deprecated: old project dir, read-only fallback
  '.superpowers',
]);
const MAX_SCAN_BYTES = 1024 * 1024;

async function readLines(
  path: string,
  offset?: number,
  limit?: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  signal?.throwIfAborted();
  const wanted = limit ?? Number.POSITIVE_INFINITY;
  const start = Math.max((offset ?? 1) - 1, 0);
  const kept: string[] = [];
  let index = 0;

  // The whole file is not read into memory: the stream closes once the requested range is full.
  const stream = createReadStream(path, { encoding: 'utf8' });
  try {
    let pending = '';
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (index >= start && kept.length < wanted) kept.push(line);
        index++;
        if (kept.length >= wanted && Number.isFinite(wanted)) break;
      }
      if (Number.isFinite(wanted) && kept.length >= wanted) break;
    }
    if (pending !== '' && index >= start && kept.length < wanted) kept.push(pending);
  } finally {
    stream.destroy();
  }
  return { ok: true, output: truncate(kept.join('\n')) };
}

export function readTools(cwd: string): Tool[] {
  const guarded = (args: Record<string, unknown>): string | ToolResult => {
    const raw = typeof args['path'] === 'string' ? args['path'] : '.';
    const target = resolveInside(cwd, raw);
    return target ?? outsideCwd(raw);
  };

  return [
    {
      access: 'read',
      def: {
        name: 'read_file',
        description: 'Reads a text file with a line range.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'path relative to cwd' },
            offset: { type: 'number', description: '1-based start line' },
            limit: { type: 'number', description: 'Number of lines to read' },
          },
          required: ['path'],
        },
      },
      async run(args, ctx: ToolContext): Promise<ToolResult> {
        const target = guarded(args);
        if (typeof target !== 'string') return target;
        try {
          const st = await stat(target);
          if (st.isDirectory()) return { ok: false, output: `is a directory: ${args['path']}` };
          return await readLines(
            target,
            typeof args['offset'] === 'number' ? args['offset'] : undefined,
            typeof args['limit'] === 'number' ? args['limit'] : undefined,
            ctx.signal,
          );
        } catch (err) {
          return { ok: false, output: `read failed: ${(err as Error).message}` };
        }
      },
    },
    {
      access: 'read',
      def: {
        name: 'list_dir',
        description: 'Lists directory contents (directories end with /).',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'path relative to cwd, default .' } },
        },
      },
      async run(args, ctx: ToolContext): Promise<ToolResult> {
        const target = guarded(args);
        if (typeof target !== 'string') return target;
        try {
          ctx.signal.throwIfAborted();
          const entries = await readdir(target, { withFileTypes: true });
          const lines = entries
            .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
            .sort((a, b) => a.localeCompare(b));
          return { ok: true, output: truncate(lines.join('\n')) };
        } catch (err) {
          return { ok: false, output: `list failed: ${(err as Error).message}` };
        }
      },
    },
    {
      access: 'read',
      def: {
        name: 'search',
        description: 'Searches text/regex, returns "path:line: content".',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text or regex to search' },
            path: { type: 'string', description: 'start directory relative to cwd' },
            maxResults: { type: 'number', description: 'Default 100' },
          },
          required: ['query'],
        },
      },
      async run(args, ctx: ToolContext): Promise<ToolResult> {
        const target = guarded(args);
        if (typeof target !== 'string') return target;
        const query = String(args['query'] ?? '');
        if (!query) return { ok: false, output: 'query required' };
        const max = typeof args['maxResults'] === 'number' ? args['maxResults'] : 100;
        let re: RegExp;
        try {
          re = new RegExp(query, 'i');
        } catch {
          re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }
        const hits: string[] = [];
        await walk(target, ctx, async (file) => {
          if (hits.length >= max) return;
          const st = await stat(file).catch(() => null);
          if (!st || st.size > MAX_SCAN_BYTES) return;
          const buf = await readFile(file).catch(() => null);
          if (!buf || buf.includes(0)) return;
          const lines = buf.toString('utf8').split(/\r?\n/);
          for (let i = 0; i < lines.length && hits.length < max; i++) {
            if (re.test(lines[i] ?? '')) {
              hits.push(`${nodePath.relative(cwd, file)}:${i + 1}: ${(lines[i] ?? '').slice(0, 300)}`);
            }
          }
        });
        return { ok: true, output: truncate(hits.join('\n')) };
      },
    },
  ];
}

async function walk(dir: string, ctx: ToolContext, onFile: (file: string) => Promise<void>): Promise<void> {
  ctx.signal.throwIfAborted();
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    ctx.signal.throwIfAborted();
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, ctx, onFile);
    } else if (entry.isFile()) {
      await onFile(full);
    }
  }
}
