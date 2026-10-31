import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { WorldModel } from '../server/memory/world.js';

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  return { log, memory, world: new WorldModel(log, memory) };
}

describe('syncFromLog', () => {
  it('writes tool results to the operation history', () => {
    const { log, world } = setup();
    log.append('tool_result', 'system', 's1', { tool: 'run_command', ok: true }, '42 test geçti');
    const last = world.syncFromLog(0);

    const history = world.history();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ tool: 'run_command', status: 'ok' });
    expect(last).toBeGreaterThan(0);
  });

  it('extracts typed facts from user messages', () => {
    const { log, world } = setup();
    log.append('message', 'user', 's1', { role: 'user' }, 'aylık bütçe 500 TL');
    world.syncFromLog(0, { entityOf: () => 'proje-x' });
    expect(world.facts({ entity: 'proje-x' })[0]?.valueNum).toBe(500);
  });

  it('does not process the same event twice', () => {
    const { log, world } = setup();
    log.append('tool_result', 'system', 's1', { tool: 'read_file', ok: true }, 'x');
    const first = world.syncFromLog(0);
    world.syncFromLog(0);
    expect(world.history()).toHaveLength(1);
    expect(first).toBeGreaterThan(0);
  });

  it('processes new events from where it left off', () => {
    const { log, world } = setup();
    const e1 = log.append('tool_result', 'system', 's1', { tool: 'a', ok: true }, '1');
    const last = world.syncFromLog(0);
    log.append('tool_result', 'system', 's1', { tool: 'b', ok: true }, '2');
    world.syncFromLog(last);
    expect(world.history().map((h) => h.tool).sort()).toEqual(['a', 'b']);
    void e1;
  });

  it('extracts no facts from assistant messages', () => {
    const { log, world } = setup();
    log.append('message', 'session', 's1', { role: 'assistant' }, 'bütçe 500 TL olacak');
    world.syncFromLog(0);
    expect(world.facts()).toHaveLength(0);
  });
});
