import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', 'server', 'app/src', 'electron', 'shared'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx|cjs)$/.test(f));

describe('no zero branding in source', () => {
  it('every source file is free of it', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relevant = readFileSync(file, 'utf8')
        .split('\n')
        // Sanctioned, one-release leftovers: the legacy path/env fallbacks.
        .filter((line) => !/deprecated|legacy|migration/i.test(line))
        .join('\n');
      if (/\bZERO\b|\bzero\b/.test(relevant)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
