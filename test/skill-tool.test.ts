import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillStore } from '../server/skills.js';
import { loadSkillTool } from '../server/engine/tools/skills.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';

function storeWith(enabled: boolean): SkillStore {
  const repo = mkdtempSync(join(tmpdir(), 'karen-skillrepo-'));
  mkdirSync(join(repo, 'a'), { recursive: true });
  writeFileSync(
    join(repo, 'a', 'SKILL.md'),
    ['---', 'name: Rapor', 'description: Rapor üretir', 'triggers: rapor', '---', 'GİZLİ GÖVDE'].join('\n'),
  );
  const store = new SkillStore(join(mkdtempSync(join(tmpdir(), 'karen-ss-')), 'skills'));
  store.install(repo);
  store.setEnabled('rapor', enabled);
  return store;
}

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal });

describe('load_skill tool', () => {
  it('returns the body of an active skill', async () => {
    const tool = loadSkillTool(storeWith(true));
    const result = await tool.run({ name: 'rapor' }, ctx('.'));
    expect(result.ok).toBe(true);
    expect(result.output).toContain('GİZLİ GÖVDE');
    expect(tool.access).toBe('read');
  });

  it('fails for an unknown or disabled skill', async () => {
    const tool = loadSkillTool(storeWith(false));
    expect((await tool.run({ name: 'rapor' }, ctx('.'))).ok).toBe(false);
    expect((await tool.run({ name: 'yok' }, ctx('.'))).ok).toBe(false);
    expect((await tool.run({}, ctx('.'))).ok).toBe(false);
  });
});

describe('katalog enjeksiyonu', () => {
  const make = (skills?: SkillStore) => {
    const provider = new FakeProvider([[{ type: 'done', stopReason: 'end' }]]);
    const sessions = new SessionManager({
      provider,
      model: 'm',
      log: new EventLog(':memory:'),
      approve: async () => true,
      onEvent: () => undefined,
      ...(skills ? { skills } : {}),
    });
    return { provider, sessions };
  };

  it('the catalogue enters the system text as a short list, the body does not', async () => {
    const { provider, sessions } = make(storeWith(true));
    const session = sessions.create({ cwd: '.' });
    await sessions.send(session.id, 'selam');

    const system = provider.calls[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('## Skills');
    expect(system).toContain('rapor: Rapor üretir');
    // the skill body arrives only when load_skill is called.
    expect(system).not.toContain('GİZLİ GÖVDE');
    expect(provider.calls[0]?.tools.map((t) => t.name)).toContain('load_skill');
  });

  it('no catalogue or tool is added without a store', async () => {
    const { provider, sessions } = make();
    const session = sessions.create({ cwd: '.' });
    await sessions.send(session.id, 'selam');
    const system = provider.calls[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).not.toContain('## Skills');
    expect(provider.calls[0]?.tools.map((t) => t.name)).not.toContain('load_skill');
  });
});
