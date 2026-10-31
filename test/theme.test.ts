import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const TOKENS = [
  '#08080a', '#0e0e12', '#14141a', '#1b1b22', '#241016',
  '#ececef', '#8f8f99', '#5a5a63', '#e11d2e', '#ff5a66',
  '#5dd1a4', '#ffc25c', '#6ea8fe',
];

const files = ['app/src/styles.css', 'app/src/command.css', 'app/src/polish.css'];
const css = files.map((f) => readFileSync(f, 'utf8')).join('\n');
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));

describe('red/black theme', () => {
  it('defines every palette token in :root', () => {
    for (const token of TOKENS) expect(root.toLowerCase()).toContain(token);
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

  it('keeps the data colour out of surfaces: at most three uses, none in the side panels', () => {
    const uses = (css.match(/var\(--data\)/g) ?? []).length + (css.match(/#6ea8fe/gi) ?? []).length;
    expect(uses).toBeLessThanOrEqual(3);
    for (const file of ['app/src/command.css', 'app/src/polish.css']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/--data\b/);
    }
  });

  it('stays inside the palette: every hex is a token value', () => {
    const allowed = new Set([
      ...TOKENS,
      '#0c0c0f', '#17171b', '#1f1f25', '#2a1216', '#3a3a44', '#2c2c34',
      '#ffb3b9', '#ffe0e3', '#4a161d', '#7a1d27', '#a8202f', '#1a0a0d',
      '#3f9c78', '#1f4a3a', '#12281f', '#b8873c', '#4a3a1c', '#2a2110',
      '#ffffff', '#000000', '#55555f', '#7a7a85',
      '#121216',
    ]);
    const hexes = (css.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toLowerCase());
    expect([...new Set(hexes.filter((h) => !allowed.has(h)))]).toEqual([]);
  });
});
