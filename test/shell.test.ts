import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RAIL, railOrder, shouldCollapse } from '../app/src/shell.js';

describe('rail', () => {
  it('lists nine screens with settings pinned last', () => {
    expect(RAIL).toHaveLength(9);
    expect(RAIL[RAIL.length - 1]!.id).toBe('settings');
    expect(new Set(RAIL.map((item) => item.id)).size).toBe(9);
  });

  it('orders screens consistently', () => {
    expect(railOrder('overview')).toBe(0);
    expect(railOrder('settings')).toBe(8);
    expect(railOrder('nope' as never)).toBe(-1);
  });

  it('collapses below 1080 px only', () => {
    expect(shouldCollapse(1079)).toBe(true);
    expect(shouldCollapse(1080)).toBe(false);
  });
});

describe('shell structure', () => {
  const shell = readFileSync('app/src/components/AppShell.tsx', 'utf8');
  const css = readFileSync('app/src/shell.css', 'utf8');
  const app = readFileSync('app/src/App.tsx', 'utf8');

  it('has one rail, one stage, one context panel', () => {
    expect((shell.match(/<nav/g) ?? []).length).toBe(1);
    expect((shell.match(/<main/g) ?? []).length).toBe(1);
    expect((shell.match(/<aside/g) ?? []).length).toBe(1);
  });

  it('collapses at one breakpoint, driven from one place', () => {
    for (const selector of ['.rail', '.topbar', '.stage', '.context', '.composer']) {
      expect(css).toContain(selector);
    }
    expect(css).toContain('grid-template-columns: 64px minmax(0, 1fr) 300px');
    // The breakpoint lives in shouldCollapse(), not duplicated in a media query.
    expect(css).toContain('.shell.narrow');
    expect(shell).toContain('shouldCollapse(window.innerWidth)');
    expect(css).not.toContain('@media (max-width: 900px)');
  });

  it('mounts the composer outside the stage, so it never scrolls away', () => {
    const main = shell.slice(shell.indexOf('<main'), shell.indexOf('</main>'));
    expect(main).not.toContain('composer');
    expect(shell.indexOf('className="composer"')).toBeGreaterThan(shell.indexOf('</main>'));
  });

  it('the app uses the shell instead of building its own frame', () => {
    expect(app).toContain('<AppShell');
    expect(app).not.toContain('className="cc-shell"');
    expect(app).not.toContain('<Sidebar');
  });
});
