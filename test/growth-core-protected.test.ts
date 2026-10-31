import { describe, it, expect } from 'vitest';
import { isAllowed, isProtected } from '../server/growth/proposals.js';

describe('the core is protected from the growth system', () => {
  it('teklif bile edilemez', () => {
    for (const kind of ['identity', 'rule', 'skill', 'code'] as const) {
      expect(isProtected('brain/core/core_identity.md')).toBe(true);
      expect(isAllowed('brain/core/core_identity.md', kind)).toBe(false);
    }
  });

  it('a normal identity can still be proposed', () => {
    expect(isAllowed('brain/identity/karen.md', 'identity')).toBe(true);
  });

  it('path traversal cannot bypass protection', () => {
    for (const kind of ['identity', 'rule', 'skill', 'code'] as const) {
      expect(isAllowed('brain/identity/../core/core_identity.md', kind)).toBe(false);
    }
    expect(isAllowed('app/../server/growth/proposals.ts', 'code')).toBe(false);
    expect(isAllowed('docs/../test/x.ts', 'code')).toBe(false);
    expect(isAllowed('brain\\identity\\..\\core\\core_identity.md', 'identity')).toBe(false);
  });

  it('the code enforcing protection is protected too', () => {
    expect(isAllowed('server/memory/identity.ts', 'code')).toBe(false);
    expect(isProtected('server/memory/identity.ts')).toBe(true);
    expect(isAllowed('server/memory/notes.ts', 'code')).toBe(true);
  });

  it('a colon (ADS/drive) is rejected at every level', () => {
    const blocked = [
      'server/memory/identity.ts::$DATA',
      'server/memory/identity.ts:stream',
      'server/memory/identity.ts.::$DATA',
      'C:/repo/server/memory/identity.ts',
    ];
    for (const kind of ['identity', 'rule', 'skill', 'code'] as const) {
      for (const path of blocked) {
        expect(isProtected(path)).toBe(false);
        expect(isAllowed(path, kind)).toBe(false);
      }
    }
    const allowed: [string, 'identity' | 'rule' | 'skill' | 'code'][] = [
      ['app/src/App.tsx', 'code'],
      ['docs/x.md', 'code'],
      ['skills/a/SKILL.md', 'skill'],
      ['brain/identity/karen.md', 'identity'],
      ['server/memory/notes.ts', 'code'],
    ];
    for (const [path, kind] of allowed) expect(isAllowed(path, kind)).toBe(true);
  });

  it('non-canonical paths cannot bypass protection', () => {
    const blocked = [
      'server/memory/./identity.ts',
      'server/memory//identity.ts',
      'server/memory/./IDENTITY.ts',
      'brain/identity/../core/x.md',
      'server\\memory\\identity.ts',
      'server\\memory\\.\\identity.ts',
      'brain\\identity\\..\\core\\x.md',
      ...(process.platform === 'win32' ? ['server/memory/identity.ts.', 'server/memory/identity.ts '] : []),
    ];
    for (const kind of ['identity', 'rule', 'skill', 'code'] as const) {
      for (const path of blocked) expect(isAllowed(path, kind)).toBe(false);
    }
    expect(isAllowed('server/memory/notes.ts', 'code')).toBe(true);
    expect(isAllowed('brain/identity/karen.md', 'identity')).toBe(true);
  });
});
