import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');

describe('landing page', () => {
  it('is English', () => {
    expect(html).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
    expect(html).toContain('lang="en"');
  });

  it('uses the new name everywhere', () => {
    expect(html).toContain('KAREN');
    expect(html).not.toMatch(/\bzero\b/i);
    expect(html).not.toContain('/BrNx01/zero');
  });

  it('uses the red-on-black palette', () => {
    expect(html).toContain('--bg: #08080a');
    expect(html).toContain('--accent: #e11d2e');
    expect(html).toContain('--accent-soft: #ff5a66');
    // The old blue/cyan accents must be gone.
    expect(html).not.toMatch(/#5aa2ff|#38e1c0|#6aa8ff/i);
  });

  it('links the installer and the repository', () => {
    expect(html).toContain('KAREN-Setup-1.2.0.exe');
    expect(html).toContain('https://github.com/BrNx01/karen/releases/latest');
  });

  it('has balanced markup', () => {
    const opens = (html.match(/<div\b/g) ?? []).length;
    const closes = (html.match(/<\/div>/g) ?? []).length;
    expect(opens).toBe(closes);
    const sections = (html.match(/<section\b/g) ?? []).length;
    expect(sections).toBe((html.match(/<\/section>/g) ?? []).length);
  });
});
