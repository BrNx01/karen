import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';

const readme = readFileSync('README.md', 'utf8');

describe('readme', () => {
  it('opens with the mark, the name and a claim', () => {
    const head = readme.slice(0, 400);
    expect(head).toContain('site/assets/karen-mark.svg');
    expect(head).toContain('# KAREN');
    expect(head).toContain('second brain');
  });

  it('keeps the section order a reader expects', () => {
    const sections = ['See KAREN in action', 'Download and use', 'One address, then models', 'Voice', 'It can use the computer', 'Memory', 'Autonomy', 'Safety model', 'Architecture', 'Development', 'Documentation', 'Contributing', 'License'];
    const positions = sections.map((title) => readme.indexOf(`## ${title}`));
    for (const [index, position] of positions.entries()) {
      expect(position, sections[index]).toBeGreaterThan(-1);
      if (index > 0) expect(position, sections[index]).toBeGreaterThan(positions[index - 1]!);
    }
  });

  it('shows real screenshots that exist on disk', () => {
    const images = [...readme.matchAll(/docs\/assets\/showcase\/([a-z-]+\.png)/g)].map((match) => match[1]);
    expect(new Set(images).size).toBeGreaterThanOrEqual(5);
    for (const image of new Set(images)) {
      expect(existsSync(`docs/assets/showcase/${image}`), image).toBe(true);
      expect(statSync(`docs/assets/showcase/${image}`).size, image).toBeGreaterThan(10_000);
    }
  });

  it('is English, with one deliberate Turkish tagline and no machine paths', () => {
    // Two deliberate exceptions: the bilingual claim line and the language name in the badge.
    const withoutTaglines = readme
      .split('\n')
      .filter((line) => !line.includes('Bilgisayarında') && !line.includes('Türkçe-e11d2e'))
      .join('\n');
    expect(withoutTaglines).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
    expect(readme).not.toMatch(/[A-Z]:\\\\/);
    expect(readme).not.toMatch(/\bzero\b/i);
  });

  it('links the karen repository and the installer', () => {
    expect(readme).toContain('https://github.com/BrNx01/karen');
    expect(readme).toMatch(/KAREN-Setup-\d+\.\d+\.\d+\.exe/);
  });

  it('does not claim anything the code does not do', () => {
    // These would be the easy lies: a cloud voice, a signed build, a mobile app.
    expect(readme).not.toMatch(/ElevenLabs|cloud voice/i);
    expect(readme).toContain('unsigned');
    expect(readme).toContain('offline');
  });
});
