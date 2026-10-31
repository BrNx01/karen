import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadIdentity } from '../server/memory/identity.js';

describe('identity files', () => {
  it('creates and reads a default when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-id-'));
    const text = loadIdentity(dir);
    expect(text).toContain('KAREN');
    expect(readFileSync(join(dir, 'brain', 'identity', 'karen.md'), 'utf8')).toContain('Identity');
  });

  it('the user edit wins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-id-'));
    loadIdentity(dir);
    mkdirSync(join(dir, 'brain', 'rules'), { recursive: true });
    writeFileSync(join(dir, 'brain', 'rules', 'benim.md'), 'Her zaman Türkçe konuş.');
    expect(loadIdentity(dir)).toContain('Her zaman Türkçe konuş.');
  });
});
