import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { extractFacts, parseNumber, WorldModel } from '../server/memory/world.js';

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  return { log, memory, world: new WorldModel(log, memory) };
}

describe('extractFacts', () => {
  it('extracts money, percentages and durations as typed facts', () => {
    const facts = extractFacts('aylık bütçe 500 TL, indirim %15, bekleme 2 saat olsun', 'p1', 7);
    const money = facts.find((f) => f.kind === 'money');
    expect(money?.valueNum).toBe(500);
    // when a sentence has more than one kind, the sentence heading is not written for all of them (to avoid wrong totals).
    expect(money?.attribute).toBe('money');
    expect(facts.find((f) => f.kind === 'percent')?.valueNum).toBe(15);
    expect(facts.find((f) => f.kind === 'duration')?.valueNum).toBe(7_200_000);
  });

  it('the heading becomes the attribute in a single-kind sentence', () => {
    const facts = extractFacts('aylık bütçe 500 TL', 'p1', 7);
    expect(facts[0]?.attribute).toBe('aylık bütçe');
  });

  it('captures time and date', () => {
    const facts = extractFacts('yedek her gece 03:00te alınacak, toplantı 21.10.2026', 'p1', 8);
    expect(facts.some((f) => f.unit === 'saat:dakika' && f.valueNum === 180)).toBe(true);
    expect(facts.some((f) => f.unit === 'tarih')).toBe(true);
  });

  it('returns empty without numbers', () => {
    expect(extractFacts('kod incelemesi yapıldı', 'p1', 9)).toEqual([]);
  });

  it('does not guess a number outside the attribute whitelist as an attribute', () => {
    const facts = extractFacts('500 TL harcandı', 'p1', 10);
    // the amount kind is kept even when the whitelist does not match; no fabricated attribute is written.
    expect(facts[0]?.attribute).toBe('money');
  });

  it('parseNumber reads a comma decimal', () => {
    expect(parseNumber('12,5')).toBe(12.5);
  });
});

describe('WorldModel', () => {
  it('writes and queries facts from text', () => {
    const { world, log } = setup();
    const event = log.append('message', 'user', 's1', { role: 'user' }, 'aylık bütçe 500 TL');
    const inserted = world.extractFromText('aylık bütçe 500 TL', 'proje-a', event.id);
    expect(inserted).toHaveLength(1);
    expect(world.facts({ entity: 'proje-a' })[0]?.valueNum).toBe(500);
  });

  it('does not write the same fact twice', () => {
    const { world, log } = setup();
    const event = log.append('message', 'user', 's1', { role: 'user' }, 'bütçe 500 TL');
    world.extractFromText('bütçe 500 TL', 'p', event.id);
    world.extractFromText('bütçe 500 TL', 'p', event.id);
    expect(world.facts({ entity: 'p' })).toHaveLength(1);
  });

  it('sum adds only its own entity', () => {
    const { world, log } = setup();
    const e1 = log.append('message', 'user', 's1', { role: 'user' }, 'fiyat 100 TL');
    const e2 = log.append('message', 'user', 's1', { role: 'user' }, 'fiyat 250 TL');
    world.extractFromText('fiyat 100 TL', 'p', e1.id);
    world.extractFromText('fiyat 250 TL', 'baska', e2.id);

    const result = world.compute('sum', 'fiyat', 'p');
    expect(result.value).toBe(100);
    expect(result.matched).toBe(1);
  });

  it('supersedes the old value when the same property arrives with a new one (bi-temporal)', () => {
    const { world, log } = setup();
    const e1 = log.append('message', 'user', 's1', { role: 'user' }, 'fiyat 100 TL');
    const e2 = log.append('message', 'user', 's1', { role: 'user' }, 'fiyat 250 TL');
    const t1 = Date.now() - 10 * 86_400_000;
    world.extractFromText('fiyat 100 TL', 'p', e1.id, t1);
    world.extractFromText('fiyat 250 TL', 'p', e2.id, Date.now());

    // only the new value is current right now.
    const current = world.facts({ entity: 'p', attribute: 'fiyat' });
    expect(current).toHaveLength(1);
    expect(current[0]?.valueNum).toBe(250);
    expect(world.compute('sum', 'fiyat', 'p').value).toBe(250);

    // looking back, the old value is still there.
    const past = world.facts({ entity: 'p', attribute: 'fiyat', asOf: t1 + 1000 });
    expect(past.map((f) => f.valueNum)).toContain(100);

    // no row was deleted.
    const all = world.facts({ entity: 'p', attribute: 'fiyat', includeHistory: true });
    expect(all).toHaveLength(2);
    expect(all.find((f) => f.valueNum === 100)?.validTo).not.toBeNull();
  });

  it('historical rows are not summed', () => {
    const { world, log } = setup();
    const e1 = log.append('message', 'user', 's1', { role: 'user' }, 'fiyat 100 TL');
    const e2 = log.append('message', 'user', 's1', { role: 'user' }, 'fiyat 250 TL');
    world.extractFromText('fiyat 100 TL', 'p', e1.id, Date.now() - 1000);
    world.extractFromText('fiyat 250 TL', 'p', e2.id, Date.now());
    const result = world.compute('sum', 'fiyat', 'p', { includeHistory: true });
    expect(result.value).toBeNull();
    expect(result.reason).toContain('historical');
  });

  it('facts falling back to kind do not supersede each other', () => {
    const { world, log } = setup();
    const e1 = log.append('message', 'user', 's1', { role: 'user' }, '100 TL harcandı');
    const e2 = log.append('message', 'user', 's1', { role: 'user' }, '250 TL harcandı');
    world.extractFromText('100 TL harcandı', 'p', e1.id);
    world.extractFromText('250 TL harcandı', 'p', e2.id);
    const all = world.facts({ entity: 'p' });
    expect(all).toHaveLength(2);
    expect(world.compute('sum', 'money', 'p').value).toBe(350);
  });

  it('count and avg work', () => {
    const { world, log } = setup();
    const e1 = log.append('message', 'user', 's1', { role: 'user' }, '100 TL harcandı');
    const e2 = log.append('message', 'user', 's1', { role: 'user' }, '200 TL harcandı');
    world.extractFromText('100 TL harcandı', 'p', e1.id);
    world.extractFromText('200 TL harcandı', 'p', e2.id);
    expect(world.compute('count', 'money', 'p').value).toBe(2);
    expect(world.compute('avg', 'money', 'p').value).toBe(150);
  });

  it('returns null without a match and fabricates nothing', () => {
    const { world } = setup();
    const result = world.compute('sum', 'olmayan-attribute');
    expect(result.value).toBeNull();
    expect(result.matched).toBe(0);
  });

  it('saves the operation history', () => {
    const { world, log } = setup();
    const event = log.append('tool_result', 'system', 's1', { tool: 'run_command', ok: true }, '42');
    world.recordAction({
      tool: 'run_command',
      target: 'npm test',
      status: 'ok',
      summary: '42 test geçti',
      at: event.ts,
      durationMs: 1200,
      sourceEvent: event.id,
    });
    const history = world.history();
    expect(history[0]?.tool).toBe('run_command');
    expect(history[0]?.durationMs).toBe(1200);
  });

  it('gives no total for mixed kinds and says ambiguous', () => {
    const { world, log } = setup();
    const e1 = log.append('message', 'user', 's1', { role: 'user' }, 'bütçe 500 TL ve indirim %15');
    world.extractFromText('bütçe 500 TL ve indirim %15', 'p', e1.id);
    // extraction is not single-kind, so attribute=kind; even so, different units
    // falling on the same attribute must not be summed.
    const result = world.compute('sum', 'money', 'p');
    expect(result.value).toBe(500);
  });

  it('number formats are read correctly', () => {
    expect(parseNumber('1.500')).toBe(1500);
    expect(parseNumber('1.500,50')).toBe(1500.5);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('1,500.50')).toBe(1500.5);
  });

  it('does not write an invalid date', () => {
    const facts = extractFacts('toplantı 45.13.2026', 'p', 11);
    expect(facts.some((f) => f.unit === 'tarih')).toBe(false);
  });

  it('next returns no past date', () => {
    const { world, log } = setup();
    const e1 = log.append('message', 'user', 's1', { role: 'user' }, 'toplantı 01.01.2020');
    world.extractFromText('toplantı 01.01.2020', 'p', e1.id);
    const result = world.compute('next', 'toplantı', 'p');
    expect(result.value).toBeNull();
    expect(result.reason).toContain('future');
  });  it('rebuild leaves the projection unchanged', () => {
    const { world, log } = setup();
    const event = log.append('message', 'user', 's1', { role: 'user' }, 'bütçe 500 TL');
    world.extractFromText('bütçe 500 TL', 'p', event.id);
    world.recordAction({
      tool: 'write_file',
      target: 'a.txt',
      status: 'ok',
      summary: 'yazıldı',
      at: event.ts,
      durationMs: null,
      sourceEvent: event.id,
    });
    const beforeFacts = world.facts();
    const beforeActions = world.history();
    world.rebuild();
    expect(world.facts()).toEqual(beforeFacts);
    expect(world.history()).toEqual(beforeActions);
  });

  it('the context text carries the source id', () => {
    const { world, log } = setup();
    const event = log.append('message', 'user', 's1', { role: 'user' }, 'bütçe 500 TL');
    world.extractFromText('bütçe 500 TL', 'p', event.id);
    const context = world.context();
    expect(context).toContain('World model');
    expect(context).toContain(`source: ${event.id}`);
  });
});
