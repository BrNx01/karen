import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envValue, migrateProfileDir, projectLogPath } from '../server/migration.js';

const dir = () => mkdtempSync(join(tmpdir(), 'karen-mig-'));

describe('migrateProfileDir', () => {
  it('copies when the new dir is absent', () => {
    const root = dir();
    const oldDir = join(root, '.zero');
    const newDir = join(root, '.karen');
    mkdirSync(join(oldDir, 'brain', 'identity'), { recursive: true });
    writeFileSync(join(oldDir, 'brain', 'identity', 'karen.md'), 'x', 'utf8');

    const report = migrateProfileDir(oldDir, newDir);

    expect(report.copied.length).toBeGreaterThan(0);
    expect(existsSync(join(newDir, 'brain', 'identity', 'karen.md'))).toBe(true);
    expect(existsSync(oldDir)).toBe(true); // never deletes
  });

  it('does nothing when the new dir exists', () => {
    const root = dir();
    mkdirSync(join(root, '.zero'), { recursive: true });
    mkdirSync(join(root, '.karen'), { recursive: true });
    expect(migrateProfileDir(join(root, '.zero'), join(root, '.karen')).copied).toEqual([]);
  });

  it('does nothing when the old dir is absent', () => {
    const root = dir();
    expect(migrateProfileDir(join(root, 'missing'), join(root, '.karen')).copied).toEqual([]);
  });
});

describe('envValue', () => {
  it('prefers the karen name', () => {
    expect(envValue('PORT', { KAREN_PORT: '1', ZERO_PORT: '2' })).toBe('1');
  });

  it('falls back to the old name', () => {
    expect(envValue('PORT', { ZERO_PORT: '2' })).toBe('2');
  });

  it('is undefined when neither exists', () => {
    expect(envValue('PORT', {})).toBeUndefined();
  });
});

describe('projectLogPath', () => {
  it('writes into .karen', () => {
    const root = dir();
    expect(projectLogPath(root)).toBe(join(root, '.karen', 'events.db'));
  });

  it('reads an existing legacy log instead of starting empty', () => {
    const root = dir();
    mkdirSync(join(root, '.zero'), { recursive: true });
    writeFileSync(join(root, '.zero', 'events.db'), '', 'utf8');
    expect(projectLogPath(root)).toBe(join(root, '.zero', 'events.db'));
  });
});
