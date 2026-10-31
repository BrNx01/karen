import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import {
  distill,
  evidenceCheck,
  parseCandidates,
  privacyCheck,
  segment,
  type Distiller,
} from '../server/memory/distill.js';

function seed(): { log: EventLog; memory: MemoryStore } {
  const log = new EventLog(':memory:');
  log.append('session_start', 'user', 's1', { cwd: '.' });
  log.append('message', 'user', 's1', { role: 'user' }, 'PDF raporu istiyorum, puppeteer ile üretelim');
  log.append('tool_call', 'session', 's1', { tool: 'run_command', args: { command: 'npm i puppeteer' }, className: 'important' });
  log.append('message', 'session', 's1', { role: 'assistant' }, 'Puppeteer kuruldu, rapor üretiliyor');
  return { log, memory: new MemoryStore(log) };
}

const fixed = (json: string): Distiller => async () => json;

describe('segment', () => {
  it('splits into user turns', () => {
    const { log } = seed();
    const blocks = segment(log.read());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.userText).toContain('PDF raporu');
    expect(blocks[0]?.events.length).toBe(4);
  });
});

describe('parseCandidates', () => {
  it('finds a JSON array inside prose', () => {
    const out = parseCandidates('işte: [{"text":"a","evidence":[1],"importance":0.5}] umarım olur');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: 'a', evidence: [1], base: 0.5, kind: 'semantic' });
  });

  it('malformed JSON returns empty', () => {
    expect(parseCandidates('[{"text":')).toEqual([]);
    expect(parseCandidates('hiç json yok')).toEqual([]);
  });
});

describe('privacyCheck', () => {
  it('rejects keys and passwords', () => {
    expect(privacyCheck('anahtar sk-abcdefghijklmnopqrstuvwxyz')).not.toBeNull();
    expect(privacyCheck('password: hunter22')).not.toBeNull();
    expect(privacyCheck('kullanıcı Türkçe sever')).toBeNull();
  });
});

describe('evidenceCheck', () => {
  it('rejects a note without a citation', () => {
    const { log } = seed();
    const block = segment(log.read())[0]!;
    const rejected = evidenceCheck(
      { kind: 'semantic', text: 'puppeteer ile rapor üretilir', concepts: [], evidence: [], base: 0.5 },
      block,
    );
    expect(rejected?.reason).toBe('kanıt yok');
  });

  it('rejects an event missing from the transcript', () => {
    const { log } = seed();
    const block = segment(log.read())[0]!;
    const rejected = evidenceCheck(
      { kind: 'semantic', text: 'puppeteer rapor üretilir', concepts: [], evidence: [999], base: 0.5 },
      block,
    );
    expect(rejected?.reason).toContain('bilinmeyen olay');
  });

  it('rejects when the cited event does not support the text', () => {
    const log = new EventLog(':memory:');
    const userEvent = log.append('message', 'user', 's1', { role: 'user' }, 'TypeScript kullanıyorum');
    const assistant = log.append('message', 'session', 's1', { role: 'assistant' }, 'tamam anladım');
    const memory = new MemoryStore(log);
    const block = segment(log.read())[0]!;

    const wrongCitation = evidenceCheck(
      { kind: 'semantic', text: 'Kullanıcı Rust kullanıyor', concepts: [], evidence: [assistant.id], base: 0.8 },
      block,
    );
    expect(wrongCitation).not.toBeNull();

    const rightCitation = evidenceCheck(
      { kind: 'semantic', text: 'Kullanıcı TypeScript kullanıyor', concepts: [], evidence: [userEvent.id], base: 0.8 },
      block,
    );
    expect(rightCitation).toBeNull();
    void memory;
  });

  it('negation and numbers cannot be changed', () => {
    const log = new EventLog(':memory:');
    log.append('message', 'user', 's1', { role: 'user' }, 'TypeScript kullanıyorum, bütçe 500 TL');
    const block = segment(log.read())[0]!;
    const id = block.events.find((e) => e.payload['role'] === 'user')?.id ?? 0;

    expect(
      evidenceCheck({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanmıyorum', concepts: [], evidence: [id], base: 0.8 }, block),
    ).not.toBeNull();
    expect(
      evidenceCheck({ kind: 'semantic', text: 'bütçe 5001 TL', concepts: [], evidence: [id], base: 0.8 }, block),
    ).not.toBeNull();
  });

  it('rejects fabricated text unsupported by the transcript', () => {
    const { log } = seed();
    const block = segment(log.read())[0]!;
    const rejected = evidenceCheck(
      {
        kind: 'semantic',
        text: 'Kullanıcı rust ile oyun motoru yazıyor',
        concepts: [],
        evidence: [block.events[1]?.id ?? 0],
        base: 0.5,
      },
      block,
    );
    expect(rejected?.reason).toMatch(/desteklemiyor/);
  });
});

describe('distill', () => {
  it('writes an episodic summary without a model and does not hallucinate', async () => {
    const { log, memory } = seed();
    const result = await distill(memory, log.read());
    expect(result.skipped).toContain('model yok');
    const notes = memory.list();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe('episodic');
    expect(notes[0]?.text).toContain('PDF raporu');
    expect(notes[0]?.evidence.length).toBeGreaterThan(0);
  });

  it('adds a verified semantic note when a model is present', async () => {
    const { log, memory } = seed();
    const ids = log.read().filter((e) => e.kind === 'message').map((e) => e.id);
    const json = JSON.stringify([
      { kind: 'semantic', text: 'PDF raporu puppeteer ile üretilir', concepts: ['puppeteer', 'pdf'], evidence: ids, importance: 0.8 },
    ]);
    const result = await distill(memory, log.read(), { distiller: fixed(json) });
    expect(result.llmCalls).toBe(1);
    const semantic = memory.list().filter((n) => n.kind === 'semantic');
    expect(semantic).toHaveLength(1);
    expect(semantic[0]?.base).toBeCloseTo(0.8);
    expect(semantic[0]?.concepts).toContain('puppeteer');
  });

  it('rejects fabricated and secret-bearing candidates', async () => {
    const { log, memory } = seed();
    const ids = log.read().filter((e) => e.kind === 'message').map((e) => e.id);
    const json = JSON.stringify([
      { kind: 'semantic', text: 'Kullanıcı rust ile oyun motoru yazıyor', evidence: ids, importance: 0.9 },
      { kind: 'semantic', text: 'API anahtarı sk-abcdefghijklmnopqrstuvwxyz', evidence: ids, importance: 0.9 },
    ]);
    const result = await distill(memory, log.read(), { distiller: fixed(json) });
    expect(memory.list().filter((n) => n.kind === 'semantic')).toEqual([]);
    expect(result.rejected.map((r) => r.reason).join(' ')).toMatch(/desteklenmiyor|gizlilik/);
  });

  it('does not crash on a model error', async () => {
    const { log, memory } = seed();
    const boom: Distiller = async () => {
      throw new Error('bağlantı yok');
    };
    const result = await distill(memory, log.read(), { distiller: boom });
    expect(result.rejected.some((r) => r.reason.includes('başarısız'))).toBe(true);
    // the episodic summary is still written
    expect(memory.list().some((n) => n.kind === 'episodic')).toBe(true);
  });

  it('a single reply cannot add unlimited notes', async () => {
    const { log, memory } = seed();
    const id = log.read().filter((e) => e.kind === 'message').map((e) => e.id)[0] ?? 0;
    const many = Array.from({ length: 50 }, (_, i) => ({
      kind: 'semantic',
      text: `puppeteer rapor notu ${i} A4`,
      evidence: [id],
      importance: 0.5,
    }));
    const result = await distill(memory, log.read(), { distiller: fixed(JSON.stringify(many)) });
    expect(result.added.length).toBeLessThanOrEqual(9); // 8 aday + 1 episodik
  });

  it('does not exceed the call budget', async () => {
    const log = new EventLog(':memory:');
    for (let i = 0; i < 5; i++) log.append('message', 'user', `s${i}`, { role: 'user' }, `konu ${i} detay`);
    const memory = new MemoryStore(log);
    const result = await distill(memory, log.read(), { distiller: fixed('[]'), maxLlmCalls: 2 });
    expect(result.llmCalls).toBe(2);
  });
});
