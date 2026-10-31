import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';

const png = readFileSync('electron/icon.png');
const svg = readFileSync('site/assets/karen-mark.svg', 'utf8');

describe('brand assets', () => {
  it('the app icon is a 512 px PNG', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(512); // IHDR width
    expect(png.readUInt32BE(20)).toBe(512); // IHDR height
  });

  it('the mark is three rings and a segmented coil, in the accent colour', () => {
    expect(svg.match(/<circle /g)?.length).toBeGreaterThanOrEqual(3);
    expect(svg).toContain('stroke="#e11d2e"');
    expect(svg).toContain('#ff5a66');
    // 24 coil segments, one arc each.
    expect((svg.match(/A138 138/g) ?? []).length).toBe(24);
  });

  it('both files stay small enough to ship', () => {
    expect(statSync('electron/icon.png').size).toBeLessThan(200 * 1024);
    expect(Buffer.byteLength(svg)).toBeLessThan(20 * 1024);
  });

  it('every surface points at the same mark', () => {
    expect(readFileSync('app/index.html', 'utf8')).toContain('/karen-mark.svg');
    expect(readFileSync('site/index.html', 'utf8')).toContain('assets/karen-mark.svg');
    expect(readFileSync('site/index.html', 'utf8')).toContain('class="orb-mark"');
    // The app-served copy is generated, so it must match the site's.
    expect(readFileSync('app/public/karen-mark.svg', 'utf8')).toBe(svg);
  });
});
