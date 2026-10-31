import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { applyTraumaDetection, detectTrauma, REPEAT_THRESHOLD } from '../server/memory/trauma.js';

const note = (
  id: string,
  text: string,
  over: Partial<{ createdAt: number; project: string | null; isTrauma: boolean; superseded: boolean }> = {},
) => ({
  id,
  text,
  createdAt: over.createdAt ?? 0,
  project: over.project ?? null,
  isTrauma: over.isTrauma ?? false,
  superseded: over.superseded ?? false,
});

describe('detectTrauma', () => {
  it('an error repeated three times marks the related note as trauma', () => {
    const errors = Array.from({ length: REPEAT_THRESHOLD }, () => ({
      message: 'electron ABI uyumsuzluğu: better-sqlite3 yeniden derlenmeli',
    }));
    const hits = detectTrauma({
      notes: [note('n1', 'better-sqlite3 electron ABI uyumsuzluğu yeniden derleme gerekir')],
      errors,
      corrections: [],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ noteId: 'n1', reason: 'repeated error' });
  });

  it('iki tekrar yetmez', () => {
    const errors = Array.from({ length: REPEAT_THRESHOLD - 1 }, () => ({ message: 'aynı hata metni burada' }));
    expect(detectTrauma({ notes: [note('n1', 'aynı hata metni burada')], errors, corrections: [] })).toEqual([]);
  });

  it('an unrelated note does not become trauma', () => {
    const errors = Array.from({ length: 5 }, () => ({ message: 'electron ABI uyumsuzluğu' }));
    const hits = detectTrauma({ notes: [note('n1', 'kullanıcı türkçe sever')], errors, corrections: [] });
    expect(hits).toEqual([]);
  });

  it('a correction with high cortisol marks trauma', () => {
    const hits = detectTrauma({
      notes: [note('n1', 'yanlış bilgi')],
      errors: [],
      corrections: [{ noteId: 'n1', cortisol: 0.7 }],
    });
    expect(hits[0]).toEqual({ noteId: 'n1', reason: 'harsh correction' });
  });

  it('a correction with low cortisol does not mark trauma', () => {
    const hits = detectTrauma({ notes: [note('n1', 'x')], errors: [], corrections: [{ noteId: 'n1', cortisol: 0.2 }] });
    expect(hits).toEqual([]);
  });

  it('a note already marked as trauma is not rewritten', () => {
    const errors = Array.from({ length: 3 }, () => ({ message: 'aynı hata metni' }));
    const hits = detectTrauma({ notes: [note('n1', 'aynı hata metni', { isTrauma: true })], errors, corrections: [] });
    expect(hits).toEqual([]);
  });

  it('empty input is safe', () => {
    expect(detectTrauma({ notes: [], errors: [], corrections: [] })).toEqual([]);
  });

  it('deterministik', () => {
    const input = {
      notes: [note('n1', 'aynı hata metni burada')],
      errors: Array.from({ length: 3 }, () => ({ message: 'aynı hata metni burada' })),
      corrections: [],
    };
    expect(detectTrauma(input)).toEqual(detectTrauma(input));
  });

  it('Turkish İ and ı are folded', () => {
    const errors = Array.from({ length: 3 }, () => ({ message: 'BİLDİRİM HATASI' }));
    expect(detectTrauma({ notes: [note('n1', 'bildirim hatası')], errors, corrections: [] })).toEqual([
      { noteId: 'n1', reason: 'repeated error' },
    ]);
    const isitma = Array.from({ length: 3 }, () => ({ message: 'isitma sorunu' }));
    expect(detectTrauma({ notes: [note('n2', 'ısıtma sorunu')], errors: isitma, corrections: [] })).toEqual([
      { noteId: 'n2', reason: 'repeated error' },
    ]);
  });

  it('a one-word message marks no unrelated notes', () => {
    const errors = Array.from({ length: 3 }, () => ({ message: 'hata' }));
    expect(detectTrauma({ notes: [note('n1', 'hata burada'), note('n2', 'hata')], errors, corrections: [] })).toEqual(
      [],
    );
  });

  it('a two-word message still matches', () => {
    const errors = Array.from({ length: 3 }, () => ({ message: 'fetch failed' }));
    expect(detectTrauma({ notes: [note('n1', 'fetch failed tekrar ediyor')], errors, corrections: [] })).toEqual([
      { noteId: 'n1', reason: 'repeated error' },
    ]);
  });

  it('word order does not split the count', () => {
    const errors = [{ message: 'alpha beta gamma' }, { message: 'beta alpha gamma' }, { message: 'gamma alpha beta' }];
    expect(detectTrauma({ notes: [note('n1', 'alpha beta gamma sorunu')], errors, corrections: [] })).toEqual([
      { noteId: 'n1', reason: 'repeated error' },
    ]);
  });

  it('an error after the note does not mark it', () => {
    const errors = Array.from({ length: 3 }, () => ({ message: 'aynı hata metni burada', ts: 100 }));
    const hits = detectTrauma({
      notes: [note('n1', 'aynı hata metni burada', { createdAt: 200 })],
      errors,
      corrections: [],
    });
    expect(hits).toEqual([]);
  });

  it('the latest time of the error group is used', () => {
    const errors = [
      { message: 'aynı hata metni burada', ts: 100 },
      { message: 'aynı hata metni burada', ts: 300 },
      { message: 'aynı hata metni burada', ts: 100 },
    ];
    const hits = detectTrauma({
      notes: [note('n1', 'aynı hata metni burada', { createdAt: 200 })],
      errors,
      corrections: [],
    });
    expect(hits).toEqual([{ noteId: 'n1', reason: 'repeated error' }]);
  });

  it('an error in another project does not mark the note', () => {
    const errors = Array.from({ length: 3 }, () => ({ message: 'aynı hata metni burada', ts: 300, project: 'a' }));
    expect(
      detectTrauma({ notes: [note('n1', 'aynı hata metni burada', { project: 'b' })], errors, corrections: [] }),
    ).toEqual([]);
    expect(
      detectTrauma({ notes: [note('n2', 'aynı hata metni burada', { project: 'a' })], errors, corrections: [] }),
    ).toEqual([{ noteId: 'n2', reason: 'repeated error' }]);
  });

  it('an invalidated note is not marked by a repeated error', () => {
    const errors = Array.from({ length: 3 }, () => ({ message: 'aynı hata metni burada' }));
    expect(
      detectTrauma({
        notes: [note('n1', 'aynı hata metni burada', { superseded: true })],
        errors,
        corrections: [],
      }),
    ).toEqual([]);
  });
});

describe('applyTraumaDetection', () => {
  it('writes what it detected and returns the id', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const n = memory.add({ kind: 'semantic', text: 'electron ABI uyumsuzluğu yeniden derleme', evidence: [1], base: 0.5 });
    const ids = applyTraumaDetection(memory, {
      notes: memory.list().map((x) => ({
        id: x.id,
        text: x.text,
        createdAt: x.createdAt,
        project: x.project,
        isTrauma: x.isTrauma,
        superseded: false,
      })),
      errors: Array.from({ length: 3 }, () => ({ message: 'electron ABI uyumsuzluğu yeniden derleme', ts: Date.now() })),
      corrections: [],
    });
    expect(ids).toContain(n.id);
    expect(memory.get(n.id)!.isTrauma).toBe(true);
  });

  it('a second call writes nothing new', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    memory.add({ kind: 'semantic', text: 'aynı hata metni burada', evidence: [1], base: 0.5 });
    const input = () => ({
      notes: memory.list().map((x) => ({
        id: x.id,
        text: x.text,
        createdAt: x.createdAt,
        project: x.project,
        isTrauma: x.isTrauma,
        superseded: false,
      })),
      errors: Array.from({ length: 3 }, () => ({ message: 'aynı hata metni burada', ts: Date.now(), project: null })),
      corrections: [],
    });
    expect(applyTraumaDetection(memory, input())).toHaveLength(1);
    expect(applyTraumaDetection(memory, input())).toHaveLength(0);
  });
});
