import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type EventKind =
  | 'session_start'
  | 'session_end'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'permission'
  | 'error'
  | 'redaction'
  | 'memory_note'
  | 'memory_link'
  | 'memory_score'
  | 'identity_change'
  | 'sleep_run'
  | 'state_signal'
  | 'state_feel'
  | 'state_change'
  | 'dmn_run'
  | 'inbox_note'
  | 'reflex';

export type Actor = 'user' | 'brain' | 'session' | 'system';

export type StoredEvent = {
  id: number;
  ts: number;
  kind: EventKind;
  actor: Actor;
  sessionId: string;
  payload: Record<string, unknown>;
  hash: string;
  prevHash: string;
  /** Raw text body (message/tool_result); empty if redacted. */
  body?: string;
};

type Row = {
  id: number;
  ts: number;
  kind: EventKind;
  actor: Actor;
  session_id: string;
  payload_json: string;
  hash: string;
  prev_hash: string;
};

const GENESIS = '';
/** `hydrate` reads bodies in chunks: stays under the SQLite variable limit. */
const BODY_CHUNK = 500;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  prev_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event_bodies (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_bodies_event ON event_bodies(event_id);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
`;

function hashOf(
  prevHash: string,
  ts: number,
  kind: string,
  actor: string,
  sessionId: string,
  payloadJson: string,
): string {
  return createHash('sha256').update(`${prevHash}|${ts}|${kind}|${actor}|${sessionId}|${payloadJson}`).digest('hex');
}

export class EventLog {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    if (dbPath !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /** So memory-layer projections can be set up on the same connection. */
  get database(): Database.Database {
    return this.db;
  }

  append(
    kind: EventKind,
    actor: Actor,
    sessionId: string,
    payload: Record<string, unknown>,
    body?: string,
  ): StoredEvent {
    const last = this.db.prepare('SELECT hash FROM events ORDER BY id DESC LIMIT 1').get() as
      | { hash: string }
      | undefined;
    const prevHash = last?.hash ?? GENESIS;
    const ts = Date.now();
    const payloadJson = JSON.stringify(payload);
    const hash = hashOf(prevHash, ts, kind, actor, sessionId, payloadJson);
    const info = this.db
      .prepare(
        'INSERT INTO events (ts, kind, actor, session_id, payload_json, hash, prev_hash) VALUES (?,?,?,?,?,?,?)',
      )
      .run(ts, kind, actor, sessionId, payloadJson, hash, prevHash);
    const id = Number(info.lastInsertRowid);
    if (body !== undefined) this.appendBody(id, body);
    return { id, ts, kind, actor, sessionId, payload, hash, prevHash };
  }

  appendBody(eventId: number, text: string): void {
    this.db.prepare('INSERT INTO event_bodies (event_id, text) VALUES (?,?)').run(eventId, text);
  }

  readBodies(eventId: number): string[] {
    const rows = this.db.prepare('SELECT text FROM event_bodies WHERE event_id = ? ORDER BY id').all(eventId) as {
      text: string;
    }[];
    return rows.map((r) => r.text);
  }

  /** Deletes the raw text. It does not touch the target event row; it writes a `redaction` event on top. */
  redact(eventId: number, reason: string): StoredEvent {
    const target = this.db.prepare('SELECT session_id FROM events WHERE id = ?').get(eventId) as
      | { session_id: string }
      | undefined;
    if (!target) throw new Error(`event not found: ${eventId}`);
    this.db.prepare('DELETE FROM event_bodies WHERE event_id = ?').run(eventId);
    return this.append('redaction', 'system', target.session_id, { targetEventId: eventId, reason });
  }

  readSince(fromEventId: number): StoredEvent[] {
    const rows = this.db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id').all(fromEventId) as Row[];
    return this.hydrate(rows);
  }
  read(sessionId?: string): StoredEvent[] {
    const rows = (
      sessionId === undefined
        ? this.db.prepare('SELECT * FROM events ORDER BY id').all()
        : this.db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY id').all(sessionId)
    ) as Row[];
    return this.hydrate(rows);
  }

  /** Adds the body and the redaction information to the rows (a single read path). */
  private hydrate(rows: Row[]): StoredEvent[] {
    const redacted = new Map<number, string>();
    for (const row of rows) {
      if (row.kind !== 'redaction') continue;
      const payload = JSON.parse(row.payload_json) as { targetEventId?: number; reason?: string };
      if (typeof payload.targetEventId === 'number') redacted.set(payload.targetEventId, payload.reason ?? 'redacted');
    }

    const ids = rows.map((r) => r.id);
    const bodyOf = new Map<number, string>();
    // Chunked query: exceeding the SQLite variable limit (32766) would make the whole read fail.
    for (let i = 0; i < ids.length; i += BODY_CHUNK) {
      const chunk = ids.slice(i, i + BODY_CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const bodies = this.db
        .prepare(`SELECT event_id, text FROM event_bodies WHERE event_id IN (${placeholders}) ORDER BY id`)
        .all(...chunk) as { event_id: number; text: string }[];
      for (const body of bodies) bodyOf.set(body.event_id, body.text);
    }

    return rows.map((row) => {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const reason = redacted.get(row.id);
      const body = bodyOf.get(row.id);
      return {
        id: row.id,
        ts: row.ts,
        kind: row.kind,
        actor: row.actor,
        sessionId: row.session_id,
        payload: reason === undefined ? payload : { ...payload, redacted: true, reason },
        hash: row.hash,
        prevHash: row.prev_hash,
        ...(body === undefined || reason !== undefined ? {} : { body }),
      };
    });
  }

  verify(): { ok: true } | { ok: false; brokenAt: number } {
    const rows = this.db.prepare('SELECT * FROM events ORDER BY id').all() as Row[];
    let prevHash = GENESIS;
    for (const row of rows) {
      const expected = hashOf(prevHash, row.ts, row.kind, row.actor, row.session_id, row.payload_json);
      if (row.prev_hash !== prevHash || row.hash !== expected) return { ok: false, brokenAt: row.id };
      prevHash = row.hash;
    }
    return { ok: true };
  }

  /** Test helper: direct SQL to see that the triggers really block. */
  rawExec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}
