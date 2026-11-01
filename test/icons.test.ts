import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PATHS } from '../app/src/icon-paths.js';

const NAMES = [
  'nav.overview', 'nav.chat', 'nav.inbox', 'nav.memory', 'nav.map', 'nav.skills', 'nav.growth', 'nav.repos', 'nav.settings',
  'action.send', 'action.mic', 'action.stop', 'action.attach', 'action.copy', 'action.refresh', 'action.approve', 'action.reject',
  'status.online', 'status.offline', 'status.thinking', 'status.done', 'status.warning', 'status.error',
  'misc.settings', 'misc.palette', 'misc.chevron',
];

describe('icon set', () => {
  it('covers every name the shell needs', () => {
    expect(Object.keys(PATHS).sort()).toEqual([...NAMES].sort());
  });

  it('every glyph is a non-empty 20x20 path', () => {
    for (const name of NAMES) {
      const d = PATHS[name as keyof typeof PATHS];
      expect(d.length, name).toBeGreaterThan(5);
      expect(d, name).toMatch(/^[Mm]/);
    }
  });

  it('draws with currentColor and no fill', () => {
    const src = readFileSync('app/src/icons.tsx', 'utf8');
    expect(src).toContain('stroke="currentColor"');
    expect(src).toContain('fill="none"');
    expect(src).not.toContain('<img');
  });

  it('leaves no emoji behind in the interface', () => {
    const files = execFileSync('git', ['ls-files', 'app/src'], { encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.(tsx|ts)$/.test(f));
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
