import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectKey, projectName } from '../server/project.js';

describe('projectKey', () => {
  it('uses the git root when present', () => {
    const root = mkdtempSync(join(tmpdir(), 'karen-proj-'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    expect(projectKey(join(root, 'src', 'deep'))).toBe(projectKey(root));
    expect(projectName(projectKey(root)).toLowerCase()).toBe(
      (root.split(/[/\\]/).filter(Boolean).pop() ?? '').toLowerCase(),
    );
  });

  it('subfolders count as different projects (without git)', () => {
    const root = mkdtempSync(join(tmpdir(), 'karen-proj-'));
    mkdirSync(join(root, 'a'), { recursive: true });
    mkdirSync(join(root, 'b'), { recursive: true });
    expect(projectKey(join(root, 'a'))).not.toBe(projectKey(join(root, 'b')));
  });

  it('path format is stable: forward slashes, no trailing slash', () => {
    const root = mkdtempSync(join(tmpdir(), 'karen-proj-'));
    const key = projectKey(`${root}${process.platform === 'win32' ? '\\' : '/'}`);
    expect(key.endsWith('/')).toBe(false);
    expect(key.includes('\\')).toBe(false);
  });
});
