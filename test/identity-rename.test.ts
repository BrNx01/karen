import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const main = readFileSync('electron/main.cjs', 'utf8');

describe('package identity', () => {
  it('is karen everywhere', () => {
    expect(pkg.name).toBe('karen');
    expect(pkg.productName).toBe('KAREN');
    expect(pkg.build.appId).toBe('com.karen.app');
    expect(pkg.build.win.artifactName).toBe('KAREN-Setup-${version}.exe');
    expect(pkg.build.win.executableName).toBe('KAREN');
    expect(pkg.build.publish[0].repo).toBe('karen');
    expect(pkg.repository.url).toContain('/karen');
    expect(pkg.homepage).toContain('/karen');
  });

  it('the shell has no zero branding', () => {
    // Sanctioned: the one line that names the pre-rename folder to copy.
    const withoutLegacy = main
      .split('\n')
      .filter((line) => !/legacy/i.test(line))
      .join('\n');
    expect(withoutLegacy).not.toMatch(/\bZERO\b/);
    expect(main).toContain('karen-data');
  });

  it('carries a pre-rename desktop profile over instead of starting empty', () => {
    // The string names the old folder that must be copied once; it is a path, not branding.
    expect(main).toMatch(/migrateLegacyData\(\);/);
    expect(main).toContain("'zero-data'");
    expect(main).toContain('fs.cpSync(legacy, target');
  });
});
