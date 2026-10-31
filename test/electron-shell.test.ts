import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// A truncated shell file still passes "grep for the name" checks but fails at
// runtime with "Unexpected end of input" inside Electron, where nothing shows it.
describe('electron shell', () => {
  for (const file of ['electron/main.cjs', 'electron/updater.cjs']) {
    it(`${file} parses`, () => {
      expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
    });
  }

  it('the updater still exports its factory', () => {
    const src = readFileSync('electron/updater.cjs', 'utf8');
    expect(src).toMatch(/module\.exports\s*=\s*\{\s*setupUpdater\s*\}/);
    expect(src).toContain('setInterval');
  });
});
