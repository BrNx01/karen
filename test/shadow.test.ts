import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shadowReport, knownRequirements } from '../server/autonomy/shadow.js';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';

const files = (map: Record<string, string>) => (p: string) => map[p] ?? null;

describe('shadowReport', () => {
  it('treats the node toolchain as ready on package.json', () => {
    const r = shadowReport({
      repoPath: 'C:\\p',
      known: ['node', 'dotnet'],
      readFile: files({ 'package.json': '{"name":"x"}' }),
    });
    expect(r.found).toContain('node');
    expect(r.missing).toContain('dotnet');
  });

  it('everything is missing without a manifest', () => {
    const r = shadowReport({ repoPath: 'C:\\p', known: ['node'], readFile: files({}) });
    expect(r.missing).toEqual(['node']);
  });

  it('produces a one-line summary and shortens it', () => {
    const r = shadowReport({
      repoPath: 'C:\\p',
      known: Array.from({ length: 40 }, (_, i) => `gereksinim-${i}`),
      readFile: files({}),
    });
    expect(r.line).not.toContain('\n');
    expect(r.line.length).toBeLessThanOrEqual(300);
    expect(r.line).toContain('missing');
  });

  it('a clean line when nothing is missing', () => {
    const r = shadowReport({ repoPath: 'C:\\p', known: ['node'], readFile: files({ 'package.json': '{}' }) });
    expect(r.line).toContain('ready');
  });

  it('a corrupt manifest does not crash', () => {
    expect(() => shadowReport({ repoPath: 'C:\\p', known: ['node'], readFile: files({ 'package.json': '{{{' }) })).not.toThrow();
  });

  it('a missing folder and file path do not crash', () => {
    expect(() => shadowReport({ repoPath: 'C:\\yok-boyle-bir-yer-123', known: ['node'] })).not.toThrow();
    expect(() => shadowReport({ repoPath: join(process.cwd(), 'package.json'), known: ['node'] })).not.toThrow();
  });

  it('treats dotnet as ready on csproj', () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-shadow-'));
    try {
      writeFileSync(join(dir, 'App.csproj'), '<Project />');
      const r = shadowReport({ repoPath: dir, known: ['dotnet'] });
      expect(r.found).toEqual(['dotnet']);
      expect(r.missing).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('onSessionStart', () => {
  it('called once when a session opens', () => {
    const seen: { cwd: string; autonomous: boolean }[] = [];
    const sessions = new SessionManager({
      provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
      model: 'm',
      log: new EventLog(':memory:'),
      approve: async () => true,
      onSessionStart: (info) => seen.push({ cwd: info.cwd, autonomous: info.autonomous }),
      onEvent: () => undefined,
    });
    sessions.create({ role: 'worker', cwd: 'C:\\repo' });
    sessions.create({ role: 'worker', cwd: 'C:\\repo', autonomous: true });
    expect(seen).toEqual([
      { cwd: 'C:\\repo', autonomous: false },
      { cwd: 'C:\\repo', autonomous: true },
    ]);
  });
});

describe('knownRequirements', () => {
  it('collects tool names from project notes', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    memory.add({ kind: 'semantic', text: 'bu repoda node ve dotnet gerekiyor', concepts: ['dotnet'], evidence: [1], base: 0.6, project: 'repo' });
    const known = knownRequirements(memory, 'repo');
    expect(known).toContain('dotnet');
    expect(known).toContain('node');
  });
});
