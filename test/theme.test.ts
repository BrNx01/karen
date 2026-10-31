import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const files = ['app/src/styles.css', 'app/src/command.css', 'app/src/polish.css'];
const css = files.map((f) => readFileSync(f, 'utf8')).join('\n');

describe('red/black theme', () => {
  it('defines the palette', () => {
    for (const token of ['#08080a', '#121216', '#2a1216', '#ececef', '#9a9aa2', '#e11d2e', '#ff5a66', '#5dd1a4', '#ffc25c']) {
      expect(css.toLowerCase()).toContain(token);
    }
  });

  it('has no blue or cyan accents left', () => {
    expect(css).not.toMatch(/#(5aa2ff|38e1c0|7fb6ff|6aa8ff|3f7fe0|4f8cff|8b9bb0|2a3546|1d2430)/i);
    expect(css).not.toMatch(/\b(blue|cyan|teal)\b/i);
  });

  it('keeps semantic colours distinct from the accent', () => {
    expect(css).toMatch(/--ok:\s*#5dd1a4/i);
    expect(css).toMatch(/--danger:\s*#e11d2e/i);
    expect(css).toMatch(/--warn:\s*#ffc25c/i);
  });

  it('stays inside the palette: every hex is a token value', () => {
    const allowed = new Set([
      '#08080a', '#0c0c0f', '#121216', '#17171b', '#1f1f25', '#2a1216', '#3a3a44',
      '#ececef', '#9a9aa2', '#e11d2e', '#ff5a66', '#ffb3b9', '#ffe0e3',
      '#5dd1a4', '#3f9c78', '#1f4a3a', '#12281f',
      '#ffc25c', '#b8873c', '#4a3a1c', '#2a2110',
      '#a8202f', '#7a1d27', '#4a161d', '#1a0a0d',
      '#ffffff', '#000000', '#55555f', '#7a7a85', '#2c2c34',
    ]);
    const hexes = (css.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toLowerCase());
    expect(hexes.filter((h) => !allowed.has(h))).toEqual([]);
  });
});
