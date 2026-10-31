import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PREFERENCE_THRESHOLD, preferenceCounts, preferenceHint, PreferenceStore,
} from '../server/brain/preferences.js';
import { EventLog } from '../server/store/events.js';
import { SessionManager } from '../server/sessions.js';
import { sessionTools } from '../server/engine/tools/sessions.js';

const dir = () => mkdtempSync(join(tmpdir(), 'karen-pref-'));
const msgs = (word: string, n: number) => Array.from({ length: n }, (_, i) => `bugun ${word} kullandim ${i}`);

describe('preferenceCounts', () => {
  it('counts a repeated tool name', () => {
    const counts = preferenceCounts(msgs('vitest', 5));
    expect(counts.find((c) => c.key === 'vitest')?.count).toBe(5);
  });

  it('durma kelimelerini saymaz', () => {
    const counts = preferenceCounts(msgs('bugun', 5));
    expect(counts.find((c) => c.key === 'bugun')).toBeUndefined();
  });

  it('counts a repeat within the same message once', () => {
    const counts = preferenceCounts(['vitest vitest vitest kullandim', 'vitest kullandim', 'vitest kullandim']);
    expect(counts.find((c) => c.key === 'vitest')?.count).toBe(3);
  });

  it('tek mesajdaki kelime aday olmaz', () => {
    const counts = preferenceCounts(['vitest vitest vitest vitest kullandim']);
    expect(counts.find((c) => c.key === 'vitest')).toBeUndefined();
  });

  it('sorts by count', () => {
    const counts = preferenceCounts([...msgs('vitest', 6), ...msgs('ollama', 3)]);
    expect(counts[0]?.key).toBe('vitest');
  });

  it('empty input is safe', () => {
    expect(preferenceCounts([])).toEqual([]);
  });
});

describe('PreferenceStore', () => {
  it('does not propose below the threshold', () => {
    const store = new PreferenceStore(dir());
    expect(store.peekOffer([{ key: 'vitest', count: PREFERENCE_THRESHOLD - 1 }])).toBeNull();
  });

  it('proposes once at the threshold', () => {
    const store = new PreferenceStore(dir());
    expect(store.peekOffer([{ key: 'vitest', count: PREFERENCE_THRESHOLD }])).toBe('vitest');
    store.markOffered('vitest', PREFERENCE_THRESHOLD);
    expect(store.peekOffer([{ key: 'vitest', count: PREFERENCE_THRESHOLD }])).toBeNull();
  });

  it('the proposal persists', () => {
    const d = dir();
    new PreferenceStore(d).markOffered('vitest', 20);
    expect(new PreferenceStore(d).offered()).toContain('vitest');
  });

  it('a corrupt file does not crash', () => {
    const d = dir();
    writeFileSync(join(d, 'preferences.json'), '{bozuk', 'utf8');
    expect(new PreferenceStore(d).offered()).toEqual([]);
  });

  it('also proposes a second different key', () => {
    const store = new PreferenceStore(dir());
    expect(store.peekOffer([{ key: 'a', count: 15 }, { key: 'b', count: 16 }])).toBe('b');
    store.markOffered('b', 16);
    expect(store.peekOffer([{ key: 'a', count: 15 }])).toBe('a');
  });
});

describe('preferenceHint', () => {
  it('one line, in Turkish', () => {
    const hint = preferenceHint('vitest', 17);
    expect(hint).toContain('vitest');
    expect(hint).toContain('17');
    expect(hint).not.toContain('\n');
    expect(hint.length).toBeLessThanOrEqual(240);
  });

  it('the question is not clipped with a long key', () => {
    const hint = preferenceHint('cok-uzun-bir-tercih-anahtari-adi-buraya-geliyor', 15);
    expect(hint.endsWith('permanent rules?')).toBe(true);
    expect(hint.length).toBeLessThanOrEqual(240);
  });
});

describe('structural cue gate', () => {
  const many = (text: string) => Array.from({ length: 15 }, (_, i) => `${text} ${i}`);

  it('prose without a cue produces no candidate', () => {
    expect(preferenceCounts(many('Bugün hava güzel değil mi'))).toEqual([]);
    expect(preferenceCounts(many('işler iyi gidiyor'))).toEqual([]);
    expect(preferenceCounts(many('teşekkür ederim'))).toEqual([]);
    expect(preferenceCounts(many('kahve içeriz belki'))).toEqual([]);
  });

  it('a tool name alone yields no candidate without a cue', () => {
    expect(preferenceCounts(many('vitest'))).toEqual([]);
  });

  it('a tool name in a message with a cue is counted', () => {
    const counts = preferenceCounts(many('vitest kullandım'));
    expect(counts.find((c) => c.key === 'vitest')?.count).toBe(15);
  });

  it('counted with an aspect/mood cue too', () => {
    const counts = preferenceCounts(many('ollama kullanıyorum artık'));
    expect(counts.find((c) => c.key === 'ollama')?.count).toBe(15);
  });

  it('an execution sentence counts as a cue', () => {
    // boundary: the "çalış" cue makes this sentence read as a preference; accepted behaviour.
    const counts = preferenceCounts(many('testleri çalıştırdım, çok yavaştı'));
    expect(counts.find((c) => c.key === 'testleri')?.count).toBe(15);
    expect(counts.find((c) => c.key === 'yavasti')?.count).toBe(15);
  });

  it('no candidate when only one of three messages carries a cue', () => {
    const counts = preferenceCounts(['vitest kullandim', 'vitest', 'vitest']);
    expect(counts.find((c) => c.key === 'vitest')).toBeUndefined();
  });

  it('a candidate when two of three messages carry a cue', () => {
    const counts = preferenceCounts(['vitest kullandim', 'vitest kullandim', 'vitest']);
    expect(counts.find((c) => c.key === 'vitest')?.count).toBe(3);
  });
});

describe('stop words', () => {
  const many = (text: string) => Array.from({ length: 15 }, (_, i) => `${text} ${i}`);

  it('function words are not candidates even with a cue', () => {
    const counts = preferenceCounts(many('bugün hava güzel kullanıyorum'));
    for (const word of ['hava', 'guzel', 'bugun', 'kullaniyorum']) {
      expect(counts.find((c) => c.key === word)).toBeUndefined();
    }
  });
});

describe('prompt hook', () => {
  function harness(preferences: PreferenceStore) {
    const log = new EventLog(':memory:');
    const requests: string[] = [];
    const sessions = new SessionManager({
      provider: {
        name: 'rec',
        async *stream(req) {
          requests.push(req.messages.find((m) => m.role === 'system')?.content ?? '');
          yield { type: 'text' as const, text: 'tamam' };
          yield { type: 'done' as const, stopReason: 'end' as const };
        },
      },
      model: 'm',
      log,
      preferences,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const brain = sessions.create({ role: 'brain' });
    return { log, requests, sessions, brain };
  }

  const agentMessages = (log: EventLog, sessionId: string, text: string) => {
    for (let i = 0; i < PREFERENCE_THRESHOLD; i++) {
      log.append('message', 'user', sessionId, { role: 'user', origin: 'agent' }, `${text} ${i}`);
    }
  };

  it('asks once when the threshold fills, then goes quiet', async () => {
    const h = harness(new PreferenceStore(dir()));
    for (let i = 0; i < PREFERENCE_THRESHOLD; i++) {
      h.log.append('message', 'user', h.brain.id, { role: 'user' }, `vitest kullandim ${i}`);
    }
    await h.sessions.send(h.brain.id, 'devam');
    expect(h.requests[0]).toContain('## Metacognition');
    expect(h.requests[0]).toContain('vitest');
    expect(h.requests[0]).toContain('Ask the user');
    await h.sessions.send(h.brain.id, 'devam');
    expect(h.requests[1]).not.toContain('Metacognition');
  });

  it('adds no line to the prompt without a candidate', async () => {
    const h = harness(new PreferenceStore(dir()));
    await h.sessions.send(h.brain.id, 'selam');
    expect(h.requests[0]).not.toContain('Metacognition');
  });

  it('agent-originated messages do not count as preferences', async () => {
    const h = harness(new PreferenceStore(dir()));
    agentMessages(h.log, h.brain.id, 'arastir');
    await h.sessions.send(h.brain.id, 'arastir', undefined, { origin: 'agent' });
    expect(h.requests[0]).not.toContain('Metacognition');
  });

  it('a worker does not consume the proposal', async () => {
    const h = harness(new PreferenceStore(dir()));
    for (let i = 0; i < PREFERENCE_THRESHOLD; i++) {
      h.log.append('message', 'user', h.brain.id, { role: 'user' }, `vitest kullandim ${i}`);
    }
    const worker = h.sessions.create({ role: 'worker' });
    await h.sessions.send(worker.id, 'selam');
    expect(h.requests[0]).not.toContain('Metacognition');
    // the proposal was not spent: the brain can still ask.
    await h.sessions.send(h.brain.id, 'devam');
    expect(h.requests[1]).toContain('Metacognition');
  });

  it('startBackground writes as agent-originated', () => {
    const h = harness(new PreferenceStore(dir()));
    const worker = h.sessions.create({ role: 'worker' });
    h.sessions.startBackground(worker.id, 'rapor üret', h.brain.id);
    const event = h.log
      .read()
      .filter((e) => e.kind === 'message' && e.sessionId === worker.id)
      .pop();
    expect(event?.payload['origin']).toBe('agent');
  });

  it('a normal user turn carries no origin', async () => {
    const h = harness(new PreferenceStore(dir()));
    await h.sessions.send(h.brain.id, 'selam');
    const event = h.log.read().filter((e) => e.kind === 'message').pop();
    expect(event?.payload['origin']).toBeUndefined();
  });

  it('session_send writes as agent-originated and does not count as a preference', async () => {
    const h = harness(new PreferenceStore(dir()));
    const worker = h.sessions.create({ role: 'worker' });
    const send = sessionTools(h.sessions, h.brain.id).find((tool) => tool.def.name === 'session_send');
    if (!send) throw new Error('session_send yok');
    for (let i = 0; i < PREFERENCE_THRESHOLD; i++) {
      const r = await send.run(
        { sessionId: worker.id, text: `vitest kullandim ${i}` },
        { cwd: worker.cwd, signal: new AbortController().signal },
      );
      expect(r.ok).toBe(true);
    }
    const event = h.log
      .read(worker.id)
      .filter((e) => e.kind === 'message' && e.payload['role'] === 'user')
      .pop();
    expect(event?.payload['origin']).toBe('agent');

    await h.sessions.send(h.brain.id, 'devam');
    expect(h.requests[0]).not.toContain('Metacognition');
  });

  it('a failed turn does not spend the proposal, the next successful turn does', async () => {
    const log = new EventLog(':memory:');
    const preferences = new PreferenceStore(dir());
    const requests: string[] = [];
    let fail = true;
    const sessions = new SessionManager({
      provider: {
        name: 'flaky',
        async *stream(req) {
          requests.push(req.messages.find((m) => m.role === 'system')?.content ?? '');
          if (fail) {
            fail = false;
            throw new Error('bağlantı koptu');
          }
          yield { type: 'text' as const, text: 'tamam' };
          yield { type: 'done' as const, stopReason: 'end' as const };
        },
      },
      model: 'm',
      log,
      preferences,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const brain = sessions.create({ role: 'brain' });
    for (let i = 0; i < PREFERENCE_THRESHOLD; i++) {
      log.append('message', 'user', brain.id, { role: 'user' }, `vitest kullandim ${i}`);
    }

    expect((await sessions.send(brain.id, 'devam')).ok).toBe(false);
    expect(preferences.offered()).toEqual([]);

    expect((await sessions.send(brain.id, 'devam')).ok).toBe(true);
    expect(requests[1]).toContain('Metacognition');
    expect(preferences.offered()).toContain('vitest');

    await sessions.send(brain.id, 'devam');
    expect(requests[2]).not.toContain('Metacognition');
    log.close();
  });
});
