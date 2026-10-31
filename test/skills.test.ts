import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSkills, parseSkill, toId } from '../server/skills.js';

const dir = () => mkdtempSync(join(tmpdir(), 'karen-skill-'));

describe('parseSkill', () => {
  it('reads frontmatter fields and keeps the body', () => {
    const skill = parseSkill(
      ['---', 'name: PDF Raporu', 'description: Veriden PDF üretir', 'triggers: pdf, rapor', '---', '# Adımlar', '', '1. yap'].join('\n'),
      'x/SKILL.md',
      'yedek',
    );
    expect(skill.name).toBe('PDF Raporu');
    expect(skill.description).toBe('Veriden PDF üretir');
    expect(skill.triggers).toEqual(['pdf', 'rapor']);
    expect(skill.id).toBe('pdf-raporu');
    expect(skill.body).toContain('# Adımlar');
    expect(skill.body).not.toContain('---');
  });

  it('derives the name from the first heading without frontmatter', () => {
    const skill = parseSkill('# Kod İncelemesi\n\nAdımlar...', 'a.md', 'dosya-adi');
    expect(skill.name).toBe('Kod İncelemesi');
    expect(skill.id).toBe('kod-incelemesi');
    expect(skill.triggers).toEqual([]);
    expect(skill.description).toBe('');
  });

  it('frontmatter is still read when the file starts with a BOM', () => {
    const skill = parseSkill('\uFEFF---\nname: PDF Rapor\ndescription: x\n---\ngövde', 'c.md', 'yedek');
    expect(skill.name).toBe('PDF Rapor');
    expect(skill.id).toBe('pdf-rapor');
  });

  it('uses the fallback name when there is no heading either', () => {
    const skill = parseSkill('düz metin', 'b.md', 'dosya-adi');
    expect(skill.name).toBe('dosya-adi');
    expect(skill.id).toBe('dosya-adi');
  });
});

describe('toId', () => {
  it('strips Turkish characters and spaces', () => {
    expect(toId('PDF Raporu Oluştur')).toBe('pdf-raporu-olustur');
    expect(toId('  ...  ')).toBe('skill');
  });
});

describe('discoverSkills', () => {
  it('finds SKILL.md under skills/ and agents/ and skips node_modules', () => {
    const root = dir();
    writeFileSync(join(root, 'SKILL.md'), '# Kök Yetenek\n');
    mkdirSync(join(root, 'skills', 'a'), { recursive: true });
    writeFileSync(join(root, 'skills', 'a', 'SKILL.md'), '---\nname: A\n---\ngövde');
    mkdirSync(join(root, 'agents'), { recursive: true });
    writeFileSync(join(root, 'agents', 'b.md'), '# Ajan B\n');
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'x', 'SKILL.md'), '# Gürültü\n');

    const skills = discoverSkills(root);
    expect(skills.map((s) => s.name).sort()).toEqual(['A', 'Ajan B', 'Kök Yetenek'].sort());
  });

  it('skips an oversized file', () => {
    const root = dir();
    writeFileSync(join(root, 'SKILL.md'), '# Büyük\n' + 'x'.repeat(300_000));
    mkdirSync(join(root, 'skills', 'k'), { recursive: true });
    writeFileSync(join(root, 'skills', 'k', 'SKILL.md'), '# Küçük\n');
    expect(discoverSkills(root).map((s) => s.name)).toEqual(['Küçük']);
  });
});
