import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('karen urls', () => {
  it('readme and site point at the karen repo', () => {
    for (const file of ['README.md', 'site/index.html']) {
      const text = readFileSync(file, 'utf8');
      expect(text).toContain('BrNx01/karen');
      expect(text).not.toContain('BrNx01/zero');
    }
  });

  it('package metadata points at karen', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.homepage).toBe('https://brnx01.github.io/karen/');
    expect(pkg.build.publish[0].repo).toBe('karen');
    expect(pkg.repository.url).toContain('BrNx01/karen');
  });

  it('the workflows are English and repo-agnostic', () => {
    for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/pages.yml']) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
      expect(text).not.toContain('BrNx01/zero');
    }
  });
});
