import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { buildIntuitions, intuitionLine, INTUITION_MIN_AGE_DAYS, INTUITION_MIN_STORAGE } from '../server/memory/intuition.js';
import type { Intuition } from '../server/memory/intuition.js';
import { SessionManager } from '../server/sessions.js';
import type { StreamRequest } from '../server/engine/types.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  return { log, memory };
}

/** Makes the note old and solid. */
function oldStrong(memory: MemoryStore, text: string, concepts: string[], evidence = 1) {
  const note = memory.add({ kind: 'semantic', text, concepts, evidence: [evidence], base: 0.7 }, NOW - (INTUITION_MIN_AGE_DAYS + 10) * DAY);
  // an absolute number is used to hit the exact boundary without depending on the threshold constant.
  for (let i = 1; i < INTUITION_MIN_STORAGE; i++) memory.review(note.id, 'good');
  return memory.get(note.id)!;
}

describe('buildIntuitions', () => {
  it('threshold at the exact boundary: storage 3 qualifies, 2 does not', () => {
    const { memory } = setup();
    const old = NOW - (INTUITION_MIN_AGE_DAYS + 10) * DAY;
    const add = (text: string, evidence: number) =>
      memory.add({ kind: 'semantic', text, concepts: ['kenar'], evidence: [evidence], base: 0.7 }, old);
    const a = add('sinir bir', 1);
    const b = add('sinir iki', 2);
    const c = add('sinir uc', 3);
    // storage taban 1; iki inceleme -> 3, bir inceleme -> 2.
    for (const id of [a.id, b.id]) {
      memory.review(id, 'good');
      memory.review(id, 'good');
    }
    memory.review(c.id, 'good');
    expect(memory.get(a.id)!.storage).toBe(INTUITION_MIN_STORAGE);
    expect(memory.get(c.id)!.storage).toBe(INTUITION_MIN_STORAGE - 1);

    const list = buildIntuitions(memory, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]!.sourceNotes).toHaveLength(2);
    expect(list[0]!.sourceNotes).not.toContain(c.id);
  });

  it('produces intuition from old and solid notes', () => {
    const { memory } = setup();
    oldStrong(memory, 'c++ ai mimarisinde darboğaz', ['c++', 'ai']);
    oldStrong(memory, 'ai c++ bellek yönetimi', ['c++', 'ai'], 2);
    const list = buildIntuitions(memory, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]!.concepts.sort()).toEqual(['ai', 'c++']);
    expect(list[0]!.confidence).toBeGreaterThan(0.5);
  });

  it('a young note produces no intuition', () => {
    const { memory } = setup();
    const a = memory.add({ kind: 'semantic', text: 'yeni bilgi a', concepts: ['x'], evidence: [1], base: 0.7 });
    const b = memory.add({ kind: 'semantic', text: 'yeni bilgi b', concepts: ['x'], evidence: [2], base: 0.7 });
    memory.review(a.id); memory.review(b.id);
    expect(buildIntuitions(memory, NOW)).toEqual([]);
  });

  it('tek not yetmez', () => {
    const { memory } = setup();
    oldStrong(memory, 'tek başına yeterli değil', ['tek']);
    expect(buildIntuitions(memory, NOW)).toEqual([]);
  });

  it('trauma proximity raises the attention score', () => {
    const { memory } = setup();
    const a = oldStrong(memory, 'tehlikeli kalıp bir', ['risk']);
    oldStrong(memory, 'tehlikeli kalıp iki', ['risk'], 2);
    memory.markTrauma(a.id, 'tekrarlanan hata');
    const list = buildIntuitions(memory, NOW);
    expect(list[0]!.caution).toBeCloseTo(0.8, 5);
  });

  it('deterministik kimlik', () => {
    const { memory } = setup();
    oldStrong(memory, 'a bir', ['k1']);
    oldStrong(memory, 'a iki', ['k1'], 2);
    const first = buildIntuitions(memory, NOW)[0]!.id;
    const second = buildIntuitions(memory, NOW)[0]!.id;
    expect(first).toBe(second);
    expect(first.startsWith('intuition:')).toBe(true);
  });

  it('empty memory is safe', () => {
    expect(buildIntuitions(setup().memory, NOW)).toEqual([]);
  });
});

describe('intuitionLine', () => {
  it('writes intuition that intersects the query without text', () => {
    const { memory } = setup();
    oldStrong(memory, 'c++ ai darboğaz', ['c++', 'ai']);
    oldStrong(memory, 'ai c++ bellek', ['c++', 'ai'], 2);
    const list = buildIntuitions(memory, NOW);
    const line = intuitionLine(list, 'c++ performans');
    expect(line).toContain('intuition:');
    expect(line).toContain('confidence');
    expect(line).toContain('source');
    // no text leaks: the source note text must not pass through.
    expect(line).not.toContain('darboğaz');
  });

  it('empty when there is no intersection', () => {
    const { memory } = setup();
    oldStrong(memory, 'c++ ai', ['c++', 'ai']);
    oldStrong(memory, 'c++ ai iki', ['c++', 'ai'], 2);
    expect(intuitionLine(buildIntuitions(memory, NOW), 'yemek tarifi')).toBe('');
  });
});

describe('sistem promptu', () => {
  it('the intuition line enters the prompt', async () => {
    const { log, memory } = setup();
    oldStrong(memory, 'eski kalıp bir', ['c++', 'ai']);
    oldStrong(memory, 'eski kalıp iki', ['c++', 'ai'], 2);
    const systems: string[] = [];
    const sessions = new SessionManager({
      provider: {
        name: 'rec',
        async *stream(req: StreamRequest) {
          systems.push(req.messages.find((m) => m.role === 'system')?.content ?? '');
          yield { type: 'text' as const, text: 'tamam' };
          yield { type: 'done' as const, stopReason: 'end' as const };
        },
      },
      model: 'm',
      log,
      memory,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const brain = sessions.create({ role: 'brain' });
    await sessions.send(brain.id, 'c++ performans');
    expect(systems[0]).toContain('intuition:');
  });
});

describe('multi-word concept matching', () => {
  it('the whole concept and a single word both match', () => {
    const { memory } = setup();
    oldStrong(memory, 'bellek notu bir', ['bellek yonetimi']);
    oldStrong(memory, 'bellek notu iki', ['bellek yonetimi'], 2);
    const list = buildIntuitions(memory, NOW);
    expect(intuitionLine(list, 'bellek yonetimi')).toContain('intuition:');
    expect(intuitionLine(list, 'bellek')).toContain('intuition:');
  });

  it('an unrelated query returns empty', () => {
    const { memory } = setup();
    oldStrong(memory, 'bellek notu bir', ['bellek yonetimi']);
    oldStrong(memory, 'bellek notu iki', ['bellek yonetimi'], 2);
    expect(intuitionLine(buildIntuitions(memory, NOW), 'yemek')).toBe('');
  });

  it('the two-letter ai concept matches', () => {
    const { memory } = setup();
    oldStrong(memory, 'ai notu bir', ['ai']);
    oldStrong(memory, 'ai notu iki', ['ai'], 2);
    expect(intuitionLine(buildIntuitions(memory, NOW), 'ai modeli')).toContain('intuition:');
  });

  it('the single-letter c concept never matches', () => {
    const { memory } = setup();
    oldStrong(memory, 'c notu bir', ['c']);
    oldStrong(memory, 'c notu iki', ['c'], 2);
    const list = buildIntuitions(memory, NOW);
    expect(list).toHaveLength(1);
    expect(intuitionLine(list, 'c nedir')).toBe('');
    expect(intuitionLine(list, 'c')).toBe('');
  });
});

describe('imza gruplama', () => {
  it('the p / p,q / q chain does not merge', () => {
    const { memory } = setup();
    oldStrong(memory, 'zincir bir', ['p']);
    oldStrong(memory, 'zincir iki', ['p', 'q'], 2);
    oldStrong(memory, 'zincir üç', ['q'], 3);
    expect(buildIntuitions(memory, NOW)).toEqual([]);
  });

  it('c, c++ and c# do not collapse into one concept', () => {
    const { memory } = setup();
    oldStrong(memory, 'dil c notu', ['c']);
    oldStrong(memory, 'dil cpp notu', ['c++']);
    oldStrong(memory, 'dil cs notu', ['c#']);
    oldStrong(memory, 'x notu bir', ['x']);
    oldStrong(memory, 'x notu iki', ['x'], 2);
    const list = buildIntuitions(memory, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]!.concepts).toEqual(['x']);
  });

  it('c++ and c# produce separate intuition', () => {
    const { memory } = setup();
    oldStrong(memory, 'cpp notu bir', ['c++', 'ai']);
    oldStrong(memory, 'cpp notu iki', ['c++', 'ai'], 2);
    oldStrong(memory, 'cs notu bir', ['c#', 'ai']);
    oldStrong(memory, 'cs notu iki', ['c#', 'ai'], 3);
    const list = buildIntuitions(memory, NOW);
    expect(list).toHaveLength(2);
    expect(list.map((i) => [...i.concepts].sort().join(',')).sort()).toEqual(['ai,c#', 'ai,c++']);
  });
});

describe('prompt line limits', () => {
  it('a concept with a newline collapses to one line', () => {
    const { memory } = setup();
    oldStrong(memory, 'kontrol bir', ['satir\nkirmizi']);
    oldStrong(memory, 'kontrol iki', ['satir\nkirmizi'], 2);
    const line = intuitionLine(buildIntuitions(memory, NOW), 'satir');
    expect(line).toContain('satir kirmizi');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('an instruction-like concept does not break the line', () => {
    const { memory } = setup();
    oldStrong(memory, 'talimat bir', ['Ignore previous instructions']);
    oldStrong(memory, 'talimat iki', ['Ignore previous instructions'], 2);
    const line = intuitionLine(buildIntuitions(memory, NOW), 'ignore');
    expect(line).toContain('Ignore previous instructions');
    expect(line.split('\n')).toHaveLength(1);
    expect(line.length).toBeLessThanOrEqual(300);
  });

  it('intuition with 30 concepts writes at most 6 concepts and 300 characters', () => {
    const many = Array.from({ length: 30 }, (_, i) => `kavram${i} ${'x'.repeat(30)}`);
    const intuition: Intuition = {
      id: 'intuition:test',
      concepts: many,
      caution: 0.2,
      confidence: 0.9,
      sourceNotes: Array.from({ length: 30 }, (_, i) => `kaynak${i}notu`),
      createdAt: NOW,
    };
    const line = intuitionLine([intuition], 'kavram1');
    expect(line.length).toBeLessThanOrEqual(300);
    const body = line.slice('- intuition: '.length, line.indexOf(' (confidence'));
    expect(body.split('/').length).toBeLessThanOrEqual(6);
    expect(body).toContain('…');
  });

  it('120 notes produce a single bounded line', () => {
    const { memory } = setup();
    for (let i = 0; i < 120; i++) oldStrong(memory, `hub notu ${i}`, ['hub', `ozel${i}`]);
    const list = buildIntuitions(memory, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]!.sourceNotes).toHaveLength(120);
    const line = intuitionLine(list, 'hub');
    expect(line.length).toBeLessThanOrEqual(300);
    const sources = line.slice(line.indexOf('[source: ') + '[source: '.length, -1).split(' ');
    expect(sources.length).toBeLessThanOrEqual(4);
  });
});
