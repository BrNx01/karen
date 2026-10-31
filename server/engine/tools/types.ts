import * as nodePath from 'node:path';
import { realpathSync } from 'node:fs';
import type { ToolDef } from '../types.js';

export type ToolResult = { ok: boolean; output: string };

export type ToolContext = { cwd: string; signal: AbortSignal };

export type Tool = {
  def: ToolDef;
  access: 'read' | 'write' | 'exec';
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
};

export const MAX_OUTPUT = 32768;

export function truncate(text: string, limit = MAX_OUTPUT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…[truncated ${text.length - limit} bytes]`;
}

export function toolDefs(tools: Tool[]): ToolDef[] {
  // If the same name arrives twice the FIRST definition wins: `runAgent`'s lookup also takes the first match.
  const byName = new Map<string, ToolDef>();
  for (const tool of tools) if (!byName.has(tool.def.name)) byName.set(tool.def.name, tool.def);
  return [...byName.values()];
}

/**
 * Returns null for a path that leaves cwd.
 * Path resolution uses the real path of the nearest existing ancestor, so
 * a symlink / junction cannot escape the root.
 */
export function resolveInside(cwd: string, path: string): string | null {
  const root = realish(cwd);
  const target = realish(nodePath.resolve(cwd, path));
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const r = norm(root);
  const t = norm(target);
  if (t === r) return target;
  return t.startsWith(r.endsWith(nodePath.sep) ? r : r + nodePath.sep) ? target : null;
}

/** Resolves the real path from the nearest existing ancestor, then appends the remaining parts. */
function realish(input: string): string {
  let current = nodePath.resolve(input);
  const rest: string[] = [];
  for (;;) {
    try {
      return nodePath.join(realpathSync.native(current), ...rest.slice().reverse());
    } catch {
      const parent = nodePath.dirname(current);
      if (parent === current) return nodePath.resolve(input);
      rest.push(nodePath.basename(current));
      current = parent;
    }
  }
}

export function outsideCwd(path: string): ToolResult {
  return { ok: false, output: `outside cwd: ${path}` };
}
