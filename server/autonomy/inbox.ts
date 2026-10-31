import Database from 'better-sqlite3';
import type { EventLog, StoredEvent } from '../store/events.js';

export type InboxKind = 'research' | 'suggestion' | 'warning' | 'shadow';

export type InboxItem = {
  id: number;
  at: number;
  kind: InboxKind;
  text: string;
  refs: string[];
  read: boolean;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  refs TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
`;

export const DEDUPE_MS = 24 * 60 * 60_000;
export const MAX_INBOX_CHARS = 300;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type Row = {
  id: number;
  at: number;
  kind: InboxKind;
  text: string;
  refs: string;
  read: number;
};

function toItem(row: Row): InboxItem {
  return {
    id: row.id,
    at: row.at,
    kind: row.kind,
    text: row.text,
    refs: JSON.parse(row.refs) as string[],
    read: row.read === 1,
  };
}

/** Flattens the text to one line; dedupe and the 300 limit look at the same form. */
export function normalizeInboxText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  // Cut on code points: an emoji is two UTF-16 units, cutting it in half corrupts it.
  // The limit never exceeds 300 as both code points and UTF-16 length.
  let out = '';
  for (const ch of flat) {
    if (out.length + ch.length > MAX_INBOX_CHARS) break;
    out += ch;
  }
  return out;
}

/**
 * Inbox projection: rows are built only from `inbox_note` events.
 * The read mark is an event too (`payload.read = true`), so a rebuild brings it back.
 */
export class InboxStore {
  private readonly db: Database.Database;

  constructor(
    private readonly log: EventLog,
    private readonly now: () => number = Date.now,
  ) {
    this.db = log.database;
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Adds missing columns to old databases; does not touch the event log. */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(inbox)').all() as { name: string }[];
    const has = (name: string) => columns.some((c) => c.name === name);
    if (!has('refs')) this.db.exec("ALTER TABLE inbox ADD COLUMN refs TEXT NOT NULL DEFAULT '[]'");
    if (!has('read')) this.db.exec('ALTER TABLE inbox ADD COLUMN read INTEGER NOT NULL DEFAULT 0');
  }

  /** Rebuilds the projection from the event log. The source of truth is always the log. */
  rebuild(): void {
    // The delete is inside the transaction too: if replay fails midway the table is not left half-built.
    this.db.transaction(() => {
      this.db.exec('DELETE FROM inbox');
      for (const event of this.log.read()) this.apply(event);
    })();
  }

  /**
   * Writes a new row. Returns null if the same kind + same normalized text exists
   * in the last 24 hours (the exact 24 hour boundary is outside the window: the row can be written again).
   */
  add(item: { kind: InboxKind; text: string; refs?: string[] }): InboxItem | null {
    const text = normalizeInboxText(item.text);
    if (text === '') throw new Error('inbox text required');
    const at = this.now();
    const duplicate = this.db
      .prepare('SELECT 1 FROM inbox WHERE kind = ? AND text = ? AND at > ?')
      .get(item.kind, text, at - DEDUPE_MS);
    if (duplicate) return null;

    // The id is derived from the log: even if the projection is incomplete, the same id is never handed out twice.
    const next = this.db
      .prepare(
        `SELECT COALESCE(MAX(CAST(json_extract(payload_json, '$.inboxId') AS INTEGER)), 0) + 1 AS id
           FROM events WHERE kind = 'inbox_note'`,
      )
      .get() as { id: number };
    // Event and projection in one transaction: a process that dies midway must not lose the row for good.
    this.db.transaction(() => {
      const event = this.log.append('inbox_note', 'brain', 'brain', {
        inboxId: next.id,
        at,
        kind: item.kind,
        text,
        refs: (item.refs ?? []).slice(0, 8),
      });
      this.apply(event);
    })();
    return this.get(next.id);
  }

  list(opts: { unreadOnly?: boolean; limit?: number } = {}): InboxItem[] {
    const limit = clampLimit(opts.limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM inbox ${opts.unreadOnly ? 'WHERE read = 0' : ''}
         ORDER BY at DESC, id DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return rows.map(toItem);
  }

  markRead(id: number): boolean {
    const item = this.get(id);
    if (!item) return false;
    if (item.read) return true;
    const event = this.log.append('inbox_note', 'brain', 'brain', { inboxId: id, read: true });
    this.apply(event);
    return true;
  }

  unreadCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM inbox WHERE read = 0').get() as { n: number };
    return row.n;
  }

  private get(id: number): InboxItem | null {
    const row = this.db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as Row | undefined;
    return row ? toItem(row) : null;
  }

  /** Applies a single event: a read event marks the row, any other one adds it. */
  private apply(event: StoredEvent): void {
    if (event.kind !== 'inbox_note') return;
    const payload = event.payload;
    const id = Number(payload['inboxId'] ?? 0);
    if (!id) return;
    if (payload['read'] === true) {
      this.db.prepare('UPDATE inbox SET read = 1 WHERE id = ?').run(id);
      return;
    }
    this.db
      .prepare('INSERT OR IGNORE INTO inbox (id, at, kind, text, refs) VALUES (?,?,?,?,?)')
      .run(
        id,
        Number(payload['at'] ?? event.ts),
        String(payload['kind'] ?? 'research'),
        String(payload['text'] ?? ''),
        JSON.stringify(payload['refs'] ?? []),
      );
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}
