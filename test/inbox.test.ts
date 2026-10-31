import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../server/store/events.js';
import { InboxStore } from '../server/autonomy/inbox.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();
const HOUR = 60 * 60_000;

function setup() {
  let clock = NOON;
  const log = new EventLog(':memory:');
  const inbox = new InboxStore(log, () => clock);
  return { log, inbox, adv: (ms: number) => (clock += ms) };
}

describe('InboxStore', () => {
  it('opens an existing database without corrupting it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'karen-inbox-db-')), 'events.db');
    const first = new EventLog(path);
    first.append('error', 'system', 'brain', { message: 'eski kayıt' });
    first.close();

    const second = new EventLog(path);
    const inbox = new InboxStore(second);
    inbox.add({ kind: 'warning', text: 'yeni not' });
    expect(inbox.list()).toHaveLength(1);
    second.close();
  });

  it('adds and lists rows', () => {
    const { inbox } = setup();
    inbox.add({ kind: 'research', text: 'C++ derleyici makalesi', refs: ['n1'] });
    const items = inbox.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe('C++ derleyici makalesi');
    expect(items[0]!.read).toBe(false);
    expect(items[0]!.refs).toEqual(['n1']);
  });

  it('does not rewrite the same row within 24 hours', () => {
    const { inbox, adv } = setup();
    inbox.add({ kind: 'research', text: 'aynı' });
    expect(inbox.add({ kind: 'research', text: 'aynı' })).toBeNull();
    adv(23 * HOUR);
    expect(inbox.add({ kind: 'research', text: 'aynı' })).toBeNull();
    adv(2 * HOUR);
    expect(inbox.add({ kind: 'research', text: 'aynı' })).not.toBeNull();
  });

  it('the row can be rewritten at exactly 24 hours (outside the window)', () => {
    const { inbox, adv } = setup();
    inbox.add({ kind: 'research', text: 'sınır' });
    adv(24 * HOUR);
    expect(inbox.add({ kind: 'research', text: 'sınır' })).not.toBeNull();
  });

  it('a different kind counts the same text as a separate row', () => {
    const { inbox } = setup();
    inbox.add({ kind: 'research', text: 'aynı metin' });
    expect(inbox.add({ kind: 'warning', text: 'aynı metin' })).not.toBeNull();
    expect(inbox.list()).toHaveLength(2);
  });

  it('a whitespace difference maps to the same row', () => {
    const { inbox } = setup();
    inbox.add({ kind: 'research', text: 'a\n\nb' });
    expect(inbox.add({ kind: 'research', text: 'a b' })).toBeNull();
    expect(inbox.list()).toHaveLength(1);
  });

  it('collapses text to one line and shortens it', () => {
    const { inbox } = setup();
    const item = inbox.add({ kind: 'warning', text: `a\n\nb   ${'x'.repeat(400)}` })!;
    expect(item.text).not.toContain('\n');
    expect(item.text.length).toBeLessThanOrEqual(300);
  });

  it('the read mark is persistent and rebuildable', () => {
    const { inbox } = setup();
    const item = inbox.add({ kind: 'research', text: 'okunacak' })!;
    expect(inbox.markRead(item.id)).toBe(true);
    expect(inbox.unreadCount()).toBe(0);
    inbox.rebuild();
    expect(inbox.unreadCount()).toBe(0);
    expect(inbox.list()[0]!.read).toBe(true);
  });

  it('does not mark an unknown id as read', () => {
    const { inbox, log } = setup();
    const before = log.read().length;
    expect(inbox.markRead(999)).toBe(false);
    expect(log.read().length).toBe(before);
  });

  it('rebuild keeps the rows', () => {
    const { inbox } = setup();
    inbox.add({ kind: 'research', text: 'bir' });
    inbox.add({ kind: 'suggestion', text: 'iki' });
    inbox.rebuild();
    expect(inbox.list()).toHaveLength(2);
  });

  it('unreadOnly and limit', () => {
    const { inbox } = setup();
    inbox.add({ kind: 'research', text: 'bir' });
    const second = inbox.add({ kind: 'research', text: 'iki' })!;
    inbox.markRead(second.id);
    expect(inbox.list({ unreadOnly: true })).toHaveLength(1);
    expect(inbox.list({ limit: 1 })).toHaveLength(1);
    expect(inbox.list({ limit: 0 })).toHaveLength(1);
    expect(inbox.list({ limit: -5 })).toHaveLength(1);
    expect(inbox.unreadCount()).toBe(inbox.list({ unreadOnly: true }).length);
  });

  it('the newest row comes first', () => {
    const { inbox } = setup();
    inbox.add({ kind: 'research', text: 'eski' });
    inbox.add({ kind: 'research', text: 'yeni' });
    expect(inbox.list().map((i) => i.text)).toEqual(['yeni', 'eski']);
  });

  it('a short table does not redistribute ids from the log', () => {
    const { inbox, log } = setup();
    inbox.add({ kind: 'research', text: 'bir' });
    inbox.add({ kind: 'research', text: 'iki' });
    // rebuild has not run yet: the projection is empty but the log is full.
    log.database.exec('DELETE FROM inbox');
    const third = inbox.add({ kind: 'research', text: 'üç' })!;
    expect(third.id).toBe(3);
    inbox.rebuild();
    expect(inbox.list().map((i) => i.text).sort()).toEqual(['bir', 'iki', 'üç']);
  });

  it('the table keeps its previous state when rebuild fails midway', () => {
    const { inbox, log } = setup();
    inbox.add({ kind: 'research', text: 'korunan' });
    // corrupt payload: log.read() throws while replaying.
    log.database
      .prepare(
        `INSERT INTO events (ts, kind, actor, session_id, payload_json, hash, prev_hash)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(NOON, 'inbox_note', 'brain', 'brain', '{bozuk', 'x', 'y');
    expect(() => inbox.rebuild()).toThrow();
    expect(inbox.list().map((i) => i.text)).toEqual(['korunan']);
  });

  it('does not split an emoji at the 300 boundary', () => {
    const { inbox } = setup();
    const item = inbox.add({ kind: 'research', text: 'x'.repeat(299) + '🙂🙂' })!;
    // 299 + 2 units exceed 300, so the emoji is dropped whole.
    expect(item.text).toBe('x'.repeat(299));
    expect(item.text.length).toBeLessThanOrEqual(300);
    expect([...item.text].length).toBeLessThanOrEqual(300);
    expect(item.text).not.toContain('\uFFFD');
    expect(item.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(item.text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});
