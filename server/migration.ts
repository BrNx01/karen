import { cpSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type MigrationReport = { copied: string[]; skipped: string[] };

/**
 * Copies an old profile dir to the new one when the new one is absent. Never deletes,
 * never throws: a failed copy leaves the old profile usable.
 */
export function migrateProfileDir(oldDir: string, newDir: string): MigrationReport {
  const report: MigrationReport = { copied: [], skipped: [] };
  if (existsSync(newDir) || !existsSync(oldDir)) return report;
  try {
    cpSync(oldDir, newDir, { recursive: true, force: false, errorOnExist: false });
    report.copied.push(oldDir);
  } catch {
    report.skipped.push(oldDir);
  }
  return report;
}

/** Reads KAREN_<name> first, then ZERO_<name> (deprecated: remove in 1.1). */
export function envValue(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`KAREN_${name}`] ?? env[`ZERO_${name}`]; // deprecated: legacy prefix, remove in 1.1
}

/** The profile dir: `~/.karen`, carrying over the legacy `~/.zero` on first run. */
export function profileDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = homedir();
  const dir = join(home, '.karen');
  // legacy: the profile used to live in ~/.zero
  migrateProfileDir(join(home, '.zero'), dir); // deprecated old path
  return dir;
}

/**
 * The event log for a project: `<cwd>/.karen/events.db`. A project-local legacy dir
 * (the deprecated `.zero` spelling) is still read when the new dir does not exist.
 */
export function projectLogPath(cwd: string): string {
  const dir = join(cwd, '.karen');
  const legacy = join(cwd, '.zero', 'events.db'); // deprecated old path
  // legacy: read an existing .zero log in place, never move it
  if (!existsSync(dir) && existsSync(legacy)) return legacy;
  return join(dir, 'events.db');
}
