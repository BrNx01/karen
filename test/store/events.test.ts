import { describe, it, expect } from 'vitest';
import { EventLog } from '../../server/store/events.js';

describe('EventLog', () => {
  it('appends in order and verifies the chain', () => {
    const log = new EventLog(':memory:');
    log.append('session_start', 'user', 's1', { cwd: '.' });
    log.append('message', 'user', 's1', { role: 'user' }, 'merhaba');
    expect(log.read('s1')).toHaveLength(2);
    expect(log.verify()).toEqual({ ok: true });
    log.close();
  });

  it('reads a log with thousands of events including bodies (chunked hydrate)', () => {
    // chunks of 500: 1200 events split into three queries; a single IN (?,…) blew up at 32k events.
    const log = new EventLog(':memory:');
    for (let i = 0; i < 1_200; i++) log.append('message', 'user', 's1', { role: 'user' }, `m${i}`);
    const events = log.read();
    expect(events).toHaveLength(1_200);
    expect(events[1_199]?.body).toBe('m1199');
    log.close();
  });

  it('direct UPDATE and DELETE are rejected', () => {
    const log = new EventLog(':memory:');
    const e = log.append('message', 'user', 's1', {}, 'x');
    expect(() => log.rawExec(`UPDATE events SET payload_json='{}' WHERE id=${e.id}`)).toThrow();
    expect(() => log.rawExec(`DELETE FROM events WHERE id=${e.id}`)).toThrow();
    log.close();
  });

  it('redaction deletes the body, keeps the event and preserves the chain', () => {
    const log = new EventLog(':memory:');
    const e = log.append('message', 'user', 's1', { role: 'user' });
    log.appendBody(e.id, 'gizli metin');
    log.redact(e.id, 'retention');
    expect(log.readBodies(e.id)).toEqual([]);
    expect(log.read('s1')[0]?.payload).toEqual({ role: 'user', redacted: true, reason: 'retention' });
    expect(log.verify()).toEqual({ ok: true });
    log.close();
  });
});
