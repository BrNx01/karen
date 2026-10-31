import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Project identity: the git root if there is one, otherwise the folder itself.
 * The full path is used so two separate "app" folders do not collide.
 */
export function projectKey(cwd: string): string {
  const start = resolve(cwd);
  const root = findRepoRoot(start);
  const target = root ?? start;
  const normalized = target.split(sep).join('/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Short display name (for the UI and context). */
export function projectName(key: string): string {
  const parts = key.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? key;
}

function findRepoRoot(start: string): string | null {
  let current = start;
  for (;;) {
    if (existsSync(join(current, '.git'))) {
      // Whether it is a directory or a file (worktree/submodule) does not matter.
      try {
        statSync(join(current, '.git'));
      } catch {
        return null;
      }
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
