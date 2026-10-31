import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  changedLines,
  containsSecret,
  isAllowed,
  isProtected,
  MAX_LINES,
  riskOf,
  runChecks,
  type Proposal,
} from '../server/growth/proposals.js';
import { ProposalStore } from '../server/growth/store.js';

const dir = () => mkdtempSync(join(tmpdir(), 'karen-growth-'));

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p1',
    createdAt: Date.now(),
    kind: 'rule',
    title: 'kural güncelle',
    reason: 'kullanıcı kısa cevap istiyor',
    files: [{ path: 'brain/rules/temel.md', before: 'eski', after: 'yeni' }],
    risk: 'low',
    status: 'pending',
    checks: [],
    ...over,
  };
}

describe('izin listesi', () => {
  it('protected paths cannot be proposed', () => {
    for (const path of [
      'server/engine/permissions.ts',
      'server/growth/proposals.ts',
      'server/settings.ts',
      'server/http/approvals.ts',
      'test/memory.test.ts',
      'electron/main.cjs',
      'package.json',
    ]) {
      expect(isProtected(path)).toBe(true);
      expect(isAllowed(path, 'code')).toBe(false);
    }
  });

  it('allowed code paths pass', () => {
    expect(isAllowed('app/src/App.tsx', 'code')).toBe(true);
    expect(isAllowed('server/memory/notes.ts', 'code')).toBe(true);
    expect(isAllowed('docs/superpowers/specs/x.md', 'code')).toBe(true);
  });

  it('identity/rule/skill paths only in data proposals', () => {
    expect(isAllowed('brain/identity/karen.md', 'identity')).toBe(true);
    expect(isAllowed('brain/rules/yeni.md', 'rule')).toBe(true);
    expect(isAllowed('skills/abc/SKILL.md', 'skill')).toBe(true);
    expect(isAllowed('brain/identity/karen.md', 'code')).toBe(false);
  });

  it('secret patterns are caught', () => {
    expect(containsSecret('const key = "sk-abcdefghijklmnopqrstuvwxyz"')).toBe(true);
    expect(containsSecret('password: hunter22')).toBe(true);
    expect(containsSecret('kullanıcı Türkçe sever')).toBe(false);
  });

  it('the line count is measured', () => {
    const files = [{ path: 'a', before: 'bir\niki', after: 'bir\niki\nüç' }];
    expect(changedLines(files)).toBe(1);
  });
});

describe('runChecks', () => {
  it('a small allowed proposal passes', async () => {
    const checks = await runChecks(proposal());
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it('a disallowed path is rejected', async () => {
    const checks = await runChecks(proposal({ files: [{ path: 'server/engine/loop.ts', before: '', after: 'x' }] }));
    expect(checks.find((c) => c.name === 'allowed-surface')?.ok).toBe(false);
  });

  it('test weakening is rejected', async () => {
    const checks = await runChecks(proposal({ files: [{ path: 'test/x.test.ts', before: '', after: 'x' }] }));
    const surface = checks.find((c) => c.name === 'allowed-surface');
    expect(surface?.ok).toBe(false);
  });

  it('an oversized patch is rejected', async () => {
    const big = Array.from({ length: MAX_LINES + 5 }, (_, i) => `satır ${i}`).join('\n');
    const checks = await runChecks(proposal({ files: [{ path: 'app/src/x.ts', before: '', after: big }] }));
    expect(checks.find((c) => c.name === 'size')?.ok).toBe(false);
  });

  it('a multi-file patch is rejected', async () => {
    const files = Array.from({ length: 4 }, (_, i) => ({ path: `app/src/f${i}.ts`, before: '', after: 'x' }));
    const checks = await runChecks(proposal({ files }));
    expect(checks.find((c) => c.name === 'size')?.ok).toBe(false);
  });

  it('a patch containing a secret is rejected', async () => {
    const checks = await runChecks(
      proposal({ files: [{ path: 'brain/rules/x.md', before: '', after: 'token: sk-abcdefghijklmnopqrstuvwxyz' }] }),
    );
    expect(checks.find((c) => c.name === 'no-secrets')?.ok).toBe(false);
  });

  it('a code proposal is high risk, a rule is low risk', () => {
    expect(riskOf({ kind: 'rule', files: [] })).toBe('low');
    expect(riskOf({ kind: 'code', files: [{ path: 'app/src/x.ts', before: '', after: '' }] })).toBe('medium');
    expect(riskOf({ kind: 'code', files: [{ path: 'server/memory/x.ts', before: '', after: '' }] })).toBe('high');
  });

  it('a non-canonical path is not silently fixed but explicitly rejected', async () => {
    const checks = await runChecks(
      proposal({ files: [{ path: 'server/memory/./notes.ts', before: '', after: 'x' }] }),
    );
    expect(checks.find((c) => c.name === 'path-canonical')?.ok).toBe(false);
    const canonical = await runChecks(
      proposal({ files: [{ path: 'server/memory/notes.ts', before: '', after: 'x' }] }),
    );
    expect(canonical.find((c) => c.name === 'path-canonical')?.ok).toBe(true);
  });
});

describe('ProposalStore', () => {
  const store = (codeEdits = false) => {
    const dataDir = dir();
    return new ProposalStore({ dataDir, repoRoot: dir(), codeEditsEnabled: codeEdits });
  };

  // mimics a leftover `ready` proposal from an old version: the checks no longer run.
  const seed = (dataDir: string, over: Partial<Proposal>) => {
    mkdirSync(join(dataDir, 'growth'), { recursive: true });
    const stored: Proposal = {
      id: 'p_seed',
      createdAt: 1,
      kind: 'rule',
      title: 't',
      reason: 'r',
      files: [],
      risk: 'low',
      status: 'ready',
      checks: [],
      ...over,
    };
    writeFileSync(join(dataDir, 'growth', 'proposals.json'), JSON.stringify([stored]), 'utf8');
  };

  it('saves the proposal and marks it ready', async () => {
    const s = store();
    const created = await s.submit({
      kind: 'rule',
      title: 'kısa cevap',
      reason: 'kullanıcı kısa istiyor',
      files: [{ path: 'brain/rules/temel.md', before: 'eski', after: 'yeni' }],
    });
    expect(created.status).toBe('ready');
    expect(s.pending()).toHaveLength(1);
  });

  it('a code proposal is rejected when source copy is off', async () => {
    const s = store(false);
    await expect(
      s.submit({
        kind: 'code',
        title: 'x',
        reason: 'y',
        files: [{ path: 'app/src/x.ts', before: '', after: 'x' }],
      }),
    ).rejects.toThrow(/source copy/);
  });

  it('a rule proposal is applied and reverted', async () => {
    const dataDir = dir();
    mkdirSync(join(dataDir, 'brain', 'rules'), { recursive: true });
    writeFileSync(join(dataDir, 'brain', 'rules', 'temel.md'), 'eski', 'utf8');
    const s = new ProposalStore({ dataDir, repoRoot: dir(), codeEditsEnabled: false });

    const created = await s.submit({
      kind: 'rule',
      title: 'güncelle',
      reason: 'test',
      files: [{ path: 'brain/rules/temel.md', before: 'eski', after: 'yeni' }],
    });
    expect(await s.apply(created.id)).toEqual({ ok: true });
    expect(s.get(created.id)?.status).toBe('applied');

    expect(await s.revert(created.id)).toEqual({ ok: true });
    expect(s.get(created.id)?.status).toBe('reverted');
  });

  it('a proposal that is not ready cannot be applied', async () => {
    const s = store();
    const created = await s.submit({
      kind: 'rule',
      title: 'x',
      reason: 'y',
      files: [{ path: 'server/engine/loop.ts', before: '', after: 'x' }],
    });
    expect(created.status).toBe('rejected');
    const result = await s.apply(created.id);
    expect(result.ok).toBe(false);
  });

  it('rejection changes state', async () => {
    const s = store();
    const created = await s.submit({
      kind: 'rule',
      title: 'x',
      reason: 'y',
      files: [{ path: 'brain/rules/a.md', before: '', after: 'x' }],
    });
    expect(s.reject(created.id)).toBe(true);
    expect(s.get(created.id)?.status).toBe('rejected');
  });

  it('an old protected code proposal is not applied and the file is unchanged', async () => {
    const dataDir = dir();
    const repoRoot = dir();
    const target = join(repoRoot, 'server', 'memory', 'identity.ts');
    mkdirSync(join(repoRoot, 'server', 'memory'), { recursive: true });
    writeFileSync(target, 'orijinal', 'utf8');
    seed(dataDir, {
      kind: 'code',
      files: [{ path: 'server/memory/identity.ts', before: 'orijinal', after: 'ele geçirildi' }],
    });

    const closed = new ProposalStore({ dataDir, repoRoot, codeEditsEnabled: false });
    expect((await closed.apply('p_seed')).ok).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe('orijinal');

    // the path gate also rejects separately in the source copy.
    const open = new ProposalStore({ dataDir, repoRoot, codeEditsEnabled: true });
    expect(await open.apply('p_seed')).toEqual({
      ok: false,
      error: 'path outside allow-list: server/memory/identity.ts',
    });
    expect(readFileSync(target, 'utf8')).toBe('orijinal');
  });

  it('an old proposal escaping the data folder is not applied', async () => {
    const dataDir = dir();
    seed(dataDir, { files: [{ path: '../kacis.md', before: '', after: 'x' }] });
    const s = new ProposalStore({ dataDir, repoRoot: dir(), codeEditsEnabled: false });
    expect(await s.apply('p_seed')).toEqual({ ok: false, error: 'path outside allow-list: ../kacis.md' });
  });

  it('does not read a file outside the data folder', () => {
    const base = dir();
    const dataDir = join(base, 'veri');
    mkdirSync(join(dataDir, 'brain', 'rules'), { recursive: true });
    writeFileSync(join(dataDir, 'brain', 'rules', 'temel.md'), 'kural', 'utf8');
    writeFileSync(join(base, 'gizli.txt'), 'gizli', 'utf8');
    const s = new ProposalStore({ dataDir, repoRoot: dir(), codeEditsEnabled: false });
    expect(s.readDataFile('../gizli.txt')).toBe('');
    expect(s.readDataFile('brain/rules/temel.md')).toBe('kural');
  });

  it('revert does not write outside the data folder', async () => {
    const dataDir = dir();
    seed(dataDir, { status: 'applied', files: [{ path: '../kacis.md', before: 'x', after: 'y' }] });
    const s = new ProposalStore({ dataDir, repoRoot: dir(), codeEditsEnabled: false });
    expect(await s.revert('p_seed')).toEqual({ ok: false, error: 'path outside allow-list: ../kacis.md' });
  });
});
