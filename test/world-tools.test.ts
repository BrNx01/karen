import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { WorldModel } from '../server/memory/world.js';
import { worldTools } from '../server/engine/tools/world.js';

const ctx = { cwd: '.', signal: new AbortController().signal };

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const world = new WorldModel(log, memory);
  const tools = worldTools(world);
  const find = (name: string) => tools.find((t) => t.def.name === name)!;
  return { log, world, find };
}

describe('world tools', () => {
  it('lists facts and cites sources', async () => {
    const { log, world, find } = setup();
    const event = log.append('message', 'user', 's1', { role: 'user' }, 'aylık bütçe 500 TL');
    world.extractFromText('aylık bütçe 500 TL', 'p', event.id);

    const result = await find('world_query').run({ entity: 'p' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('500 TL');
    expect(result.output).toContain(`source: ${event.id}`);
  });

  it('computes and returns a source', async () => {
    const { log, world, find } = setup();
    const e1 = log.append('message', 'user', 's1', { role: 'user' }, '100 TL harcandı');
    const e2 = log.append('message', 'user', 's1', { role: 'user' }, '250 TL harcandı');
    world.extractFromText('100 TL harcandı', 'p', e1.id);
    world.extractFromText('250 TL harcandı', 'p', e2.id);

    const result = await find('world_compute').run({ op: 'sum', attribute: 'money', entity: 'p' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('350');
  });

  it('rejects an invalid operation', async () => {
    const { find } = setup();
    const result = await find('world_compute').run({ op: 'uydur', attribute: 'fiyat' }, ctx);
    expect(result.ok).toBe(false);
  });

  it('fabricates nothing without records', async () => {
    const { find } = setup();
    const result = await find('world_compute').run({ op: 'sum', attribute: 'bütçe' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('no records');
  });

  it('lists the operation history', async () => {
    const { log, world, find } = setup();
    const event = log.append('tool_result', 'system', 's1', { tool: 'run_command', ok: true }, '42');
    world.recordAction({
      tool: 'run_command',
      target: 'npm test',
      status: 'ok',
      summary: '42 test geçti',
      at: event.ts,
      durationMs: 800,
      sourceEvent: event.id,
    });
    const result = await find('world_history').run({}, ctx);
    expect(result.output).toContain('run_command');
    expect(result.output).toContain('42 test geçti');
  });

  it('all world tools are read permission class', () => {
    const { find } = setup();
    for (const name of ['world_query', 'world_compute', 'world_history']) {
      expect(find(name).access).toBe('read');
    }
  });
});
