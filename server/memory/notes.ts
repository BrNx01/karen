import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { EventLog, StoredEvent } from '../store/events.js';
import {
  combinedStrength,
  DEFAULT_DIFFICULTY,
  DEFAULT_STABILITY,
  DEFAULT_STORAGE,
  initialStability,
  MAX_STORAGE,
  nextDifficulty,
  nextStability,
  retrievability,
  shouldGoDormant,
} from './fsrs.js';
import { decayedWeight, isStrong, LINK_FLOOR, reinforce } from './links.js';

export type NoteKind = 'episodic' | 'semantic';

export type Note = {
  id: string;
  kind: NoteKind;
  text: string;
  project: string | null;
  concepts: string[];
  evidence: number[];
  base: number;
  createdAt: number;
  lastRecalledAt: number | null;
  recallCount: number;
  corrected: boolean;
  forgotten: boolean;
  dormant: boolean;
  conflict: boolean;
  /** Trauma: never goes cold, its strength never falls below the floor. */
  isTrauma: boolean;
  /** FSRS: stability (days), difficulty (1..10), storage strength (1..20), last review. */
  stability: number;
  difficulty: number;
  storage: number;
  lastReview: number | null;
  surprise: number;
};

export type RecalledNote = Note & {
  strength: number;
  score: number;
  lobes: ('left' | 'right')[];
};

export type NoteInput = {
  kind: NoteKind;
  text: string;
  project?: string | null;
  concepts?: string[];
  evidence: number[];
  base: number;
  /** 0..1 — how different the new information is from the existing (high = decays slowly). */
  surprise?: number;
};

export const DORMANT_THRESHOLD = 0.15;
export const CORE_THRESHOLD = 0.8;
/** A trauma note's strength never falls below this floor: trauma does not decay. */
export const TRAUMA_STRENGTH_FLOOR = 0.5;
export const MAX_NOTE_CHARS = 2000;
const HALF_LIFE_DAYS = 30;
const RRF_K = 60;
/**
 * How many note pairs at most are linked in one turn. If unbounded, 10 notes would
 * produce 45 pairs, the graph would saturate within days and the right lobe would bring everything.
 */
export const MAX_CO_RECALL_PAIRS = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  project TEXT,
  concepts TEXT NOT NULL,
  evidence TEXT NOT NULL,
  base REAL NOT NULL,
  created_at INTEGER NOT NULL,
  last_recalled_at INTEGER,
  recall_count INTEGER NOT NULL DEFAULT 0,
  corrected INTEGER NOT NULL DEFAULT 0,
  forgotten INTEGER NOT NULL DEFAULT 0,
  dormant INTEGER NOT NULL DEFAULT 0,
  conflict INTEGER NOT NULL DEFAULT 0,
  is_trauma INTEGER NOT NULL DEFAULT 0,
  stability REAL,
  difficulty REAL,
  storage REAL,
  last_review INTEGER,
  surprise REAL
);
CREATE TABLE IF NOT EXISTS memory_links (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  weight REAL NOT NULL,
  last_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS memory_conflicts (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS memory_links_b ON memory_links(b);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, text, concepts, tokenize='unicode61 remove_diacritics 2');
`;

/** A note id is derived from the text: the same text lands on the same note, a different text becomes a new note. */
export function noteId(kind: NoteKind, text: string, project: string | null = null): string {
  const normalized = normalizeText(text);
  return createHash('sha1').update(`${kind}|${project ?? ''}|${normalized}`).digest('hex').slice(0, 16);
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Folding for search: reduces Turkish characters to ASCII so "yedek" and
 * "yedeğini", "rapor" and "raporu" meet at the same stem.
 */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Human brain simulation (FSRS + dual strength):
 * - `retrieval` falls over time (power-law curve),
 * - `storage` never decreases (persistence),
 * - a correction leaves a permanent bonus (the strongest learning signal).
 */
export function strength(note: Note, now = Date.now()): number {
  const last = note.lastReview ?? note.lastRecalledAt ?? note.createdAt;
  const elapsedDays = Math.max(0, (now - last) / 86_400_000);
  // Automatic recall does not raise storage; it is only counted (see decision 12.3).
  const storage = Math.max(note.storage, Math.min(MAX_STORAGE, 1 + Math.log(1 + note.recallCount) * 1.5));
  const { score } = combinedStrength(elapsedDays, note.stability, storage);
  const value = Math.min(1, Math.max(0, score + (note.corrected ? 0.15 : 0)));
  // Trauma does not decay: even if the FSRS constants change, strength never falls below the floor.
  return note.isTrauma ? Math.max(TRAUMA_STRENGTH_FLOOR, value) : value;
}

type NoteRow = {
  id: string;
  kind: NoteKind;
  text: string;
  project: string | null;
  concepts: string;
  evidence: string;
  base: number;
  created_at: number;
  last_recalled_at: number | null;
  recall_count: number;
  corrected: number;
  forgotten: number;
  dormant: number;
  conflict: number;
  is_trauma: number;
  stability: number | null;
  difficulty: number | null;
  storage: number | null;
  last_review: number | null;
  surprise: number | null;
};

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    project: row.project,
    concepts: JSON.parse(row.concepts) as string[],
    evidence: JSON.parse(row.evidence) as number[],
    base: row.base,
    createdAt: row.created_at,
    lastRecalledAt: row.last_recalled_at,
    recallCount: row.recall_count,
    corrected: row.corrected === 1,
    forgotten: row.forgotten === 1,
    dormant: row.dormant === 1,
    conflict: row.conflict === 1,
    isTrauma: row.is_trauma === 1,
    stability: row.stability ?? DEFAULT_STABILITY,
    difficulty: row.difficulty ?? DEFAULT_DIFFICULTY,
    storage: row.storage ?? DEFAULT_STORAGE,
    lastReview: row.last_review,
    surprise: row.surprise ?? 0,
  };
}

export class MemoryStore {
  private readonly db: Database.Database;

  constructor(private readonly log: EventLog) {
    this.db = log.database;
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Adds the new columns to old databases (does not touch the append-only log). */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(memory_notes)').all() as { name: string }[];
    const has = (name: string) => columns.some((c) => c.name === name);
    const add = (sql: string) => this.db.exec(sql);

    if (!has('conflict')) add('ALTER TABLE memory_notes ADD COLUMN conflict INTEGER NOT NULL DEFAULT 0');
    if (!has('is_trauma')) add('ALTER TABLE memory_notes ADD COLUMN is_trauma INTEGER NOT NULL DEFAULT 0');
    // FSRS: existing notes start with default values (decision 12.2).
    if (!has('stability')) add('ALTER TABLE memory_notes ADD COLUMN stability REAL');
    if (!has('difficulty')) add('ALTER TABLE memory_notes ADD COLUMN difficulty REAL');
    if (!has('storage')) add('ALTER TABLE memory_notes ADD COLUMN storage REAL');
    if (!has('last_review')) add('ALTER TABLE memory_notes ADD COLUMN last_review INTEGER');
    if (!has('surprise')) add('ALTER TABLE memory_notes ADD COLUMN surprise REAL');

    // Rows migrated with last_at = 0 count as fresh: the migration does not rot the backlog at once.
    const linkColumns = this.db.prepare('PRAGMA table_info(memory_links)').all() as { name: string }[];
    if (!linkColumns.some((c) => c.name === 'last_at')) {
      add('ALTER TABLE memory_links ADD COLUMN last_at INTEGER NOT NULL DEFAULT 0');
    }
  }

  /** Rebuilds the projection from the event log. The source of truth is always the log. */
  rebuild(): void {
    this.db.exec('DELETE FROM memory_notes; DELETE FROM memory_links; DELETE FROM memory_fts; DELETE FROM memory_conflicts;');
    for (const event of this.log.read()) this.apply(event);
  }

  list(opts: { includeDormant?: boolean; includeForgotten?: boolean; project?: string } = {}): Note[] {
    const rows = this.db.prepare('SELECT * FROM memory_notes ORDER BY created_at DESC').all() as NoteRow[];
    return rows
      .map(toNote)
      .filter((n) => (opts.includeForgotten ? true : !n.forgotten))
      .filter((n) => (opts.includeDormant ? true : !n.dormant))
      // Notes without a project are global; the project filter does not exclude them.
      .filter((n) => (opts.project ? n.project === null || n.project === opts.project : true));
  }

  get(id: string): Note | null {
    const row = this.db.prepare('SELECT * FROM memory_notes WHERE id = ?').get(id) as NoteRow | undefined;
    return row ? toNote(row) : null;
  }

  /**
   * Writes a new note. If the same text already exists it does not overwrite it, it raises the
   * recall counter (conflicting text stays as a separate note; it is not silently overwritten).
   */
  add(input: NoteInput, now = Date.now()): Note {
    const text = input.text.trim().slice(0, MAX_NOTE_CHARS);
    if (text === '') throw new Error('note text required');
    const project = input.project ?? null;
    const id = noteId(input.kind, text, project);
    const existing = this.get(id);
    if (existing) {
      this.appendScore(id, 'recall', { deltaRecall: 1 });
      return this.get(id) as Note;
    }
    const event = this.log.append('memory_note', 'brain', sessionOf(input), {
      noteId: id,
      kind: input.kind,
      text,
      project,
      concepts: (input.concepts ?? []).slice(0, 8).map((c) => c.slice(0, 40)),
      evidence: input.evidence,
      base: clamp01(input.base),
      createdAt: now,
      // FSRS initial state: importance + surprise feed into stability.
      stability: initialStability(clamp01(input.base), input.surprise ?? 0),
      difficulty: clamp01(input.base) > 0.7 ? 3 : DEFAULT_DIFFICULTY,
      storage: DEFAULT_STORAGE,
      surprise: input.surprise ?? 0,
    });
    this.apply(event);

    // If the new note conflicts with an old one both are marked; neither is silently overwritten.
    const conflicting = this.findConflict(text, project, id);
    if (conflicting) this.markConflict(id, conflicting.id);
    return this.get(id) as Note;
  }

  /** A note about the same topic but with opposite negation (deterministic). */
  findConflict(text: string, project: string | null, excludeId?: string): Note | null {
    const negation = hasNegation(text);
    for (const note of this.list({ includeDormant: true })) {
      if (note.id === excludeId) continue;
      if (note.project !== project) continue;
      if (!shareTopic(note.text, text)) continue;
      if (hasNegation(note.text) !== negation) return note;
    }
    return null;
  }

  /**
   * Hebbian link: an existing link is strengthened, a new one is seeded.
   * The event carries the computed weight; a rebuild writes the same value (no double application).
   */
  link(a: string, b: string, weight = 0.5, now = Date.now()): void {
    if (a === b) return;
    const existing = this.linkWeight(a, b, now);
    const next = existing ? reinforce(existing.weight) : clamp01(weight);
    // A broken weight must not enter the log: a 0/NaN link is not written.
    if (!Number.isFinite(next) || next <= 0) return;
    this.apply(this.log.append('memory_link', 'brain', 'brain', { a, b, weight: next, lastAt: now }));
  }

  /**
   * Notes recalled in the same turn are linked to each other (Hebbian: fired together,
   * wired together). At most `MAX_CO_RECALL_PAIRS` pairs; the returned number is the pairs linked.
   */
  coRecall(ids: string[], now = Date.now()): number {
    const unique = [...new Set(ids)].filter((id) => {
      const note = this.get(id);
      return note !== null && !note.forgotten;
    });
    if (unique.length < 2) return 0;
    let count = 0;
    for (let i = 0; i < unique.length && count < MAX_CO_RECALL_PAIRS; i++) {
      for (let j = i + 1; j < unique.length && count < MAX_CO_RECALL_PAIRS; j++) {
        // `link` strengthens an existing link, it does not overwrite it.
        this.link(unique[i]!, unique[j]!, 0.5, now);
        count++;
      }
    }
    return count;
  }

  /** Decayed link weight on the read path. last_at = 0 (migration) counts as fresh. */
  linkWeight(a: string, b: string, now = Date.now()): { weight: number; lastAt: number } | null {
    const row = this.db
      .prepare('SELECT weight, last_at FROM memory_links WHERE a = ? AND b = ?')
      .get(a, b) as { weight: number; last_at: number } | undefined;
    if (!row) return null;
    const lastAt = freshLastAt(row.last_at, now);
    return { weight: decayedLinkWeight(row.weight, lastAt, now), lastAt };
  }

  /** Marks a note as trauma: it never goes cold, its strength never falls below the floor. */
  markTrauma(id: string, reason: string): boolean {
    const note = this.get(id);
    if (!note || note.isTrauma) return false;
    this.appendScore(id, 'trauma', { reason });
    return true;
  }

  traumaNotes(): Note[] {
    return this.list({ includeDormant: true }).filter((n) => n.isTrauma);
  }

  forget(id: string): boolean {
    if (!this.get(id)) return false;
    this.appendScore(id, 'forget');
    return true;
  }

  restore(id: string): boolean {
    const note = this.get(id);
    if (!note) return false;
    this.appendScore(id, 'restore');
    return true;
  }

  /** User correction: the strongest learning signal. */
  correct(id: string, text?: string, opts: { cortisol?: number } = {}): boolean {
    const note = this.get(id);
    if (!note) return false;
    const payload = opts.cortisol === undefined ? {} : { cortisol: opts.cortisol };
    if (text !== undefined && text.trim() !== '' && text.trim() !== note.text) {
      // The old note is weakened, the corrected text enters as a new note.
      const next = this.add({ ...note, text, base: Math.max(note.base, 0.8) });
      // The new id is carried in the payload: the trauma lesson belongs to the new note, not to the wrong old one.
      this.appendScore(id, 'supersede', { ...payload, newNoteId: next.id });
      return true;
    }
    this.appendScore(id, 'correct', payload);
    return true;
  }

  /**
   * Explicit review: the user found the note useful / confirmed it.
   * Storage strength rises (never decreases), stability grows with FSRS, difficulty falls.
   */
  review(id: string, grade: 'again' | 'hard' | 'good' | 'easy' = 'good', now = Date.now()): boolean {
    const note = this.get(id);
    if (!note) return false;
    if (grade === 'again') {
      this.appendScore(id, 'review', {
        at: now,
        stability: Math.max(1, note.stability * 0.5),
        difficulty: nextDifficulty(note.difficulty, 'harder'),
        storage: note.storage,
        lastReview: now,
      });
      return true;
    }
    const last = note.lastReview ?? note.lastRecalledAt ?? note.createdAt;
    const elapsedDays = Math.max(0, (now - last) / 86_400_000);
    const r = retrievability(elapsedDays, note.stability);
    this.appendScore(id, 'review', {
      at: now,
      stability: nextStability(note.stability, note.difficulty, r, grade),
      difficulty: nextDifficulty(note.difficulty, 'easier'),
      // Storage strength rises on every review; it never falls.
      storage: Math.min(MAX_STORAGE, note.storage + 1),
      lastReview: now,
    });
    return true;
  }

  recordRecall(ids: string[], now = Date.now()): void {
    for (const id of ids) {
      const note = this.get(id);
      if (!note) continue;
      // Decision 12.3: automatic recall does not raise storage; it refreshes stability at most once
      // a day. Otherwise every context injection would make a note immortal.
      const last = note.lastReview ?? note.lastRecalledAt ?? note.createdAt;
      const elapsedDays = (now - last) / 86_400_000;
      const refresh = elapsedDays >= 1;
      this.appendScore(id, 'recall', {
        deltaRecall: 1,
        at: now,
        ...(refresh
          ? {
              stability: nextStability(
                note.stability,
                note.difficulty,
                retrievability(elapsedDays, note.stability),
                'good',
              ),
              lastReview: now,
            }
          : {}),
      });
    }
  }

  /** Notes that fall below the strength threshold are not deleted, they sink into cold storage. */
  decay(now = Date.now()): { dormant: string[]; woke: string[] } {
    const dormant: string[] = [];
    const woke: string[] = [];
    for (const note of this.list({ includeDormant: true, includeForgotten: true })) {
      // Trauma is deliberately permanent: decay never lowers it.
      if (note.forgotten || note.isTrauma) continue;
      const last = note.lastReview ?? note.lastRecalledAt ?? note.createdAt;
      const elapsedDays = Math.max(0, (now - last) / 86_400_000);
      const retrieval = retrievability(elapsedDays, note.stability);
      const storage = Math.max(note.storage, 1 + Math.log(1 + note.recallCount) * 1.5);
      const goDormant = shouldGoDormant(retrieval, storage);
      if (goDormant && !note.dormant) {
        this.appendScore(note.id, 'dormant');
        dormant.push(note.id);
      } else if (!goDormant && note.dormant) {
        this.appendScore(note.id, 'wake');
        woke.push(note.id);
      }
    }
    return { dormant, woke };
  }

  /** Links are written both ways; the a side is the single source, so no double counting. */
  linksOf(id: string, now = Date.now()): { id: string; weight: number }[] {
    const rows = this.db
      .prepare('SELECT b, weight, last_at FROM memory_links WHERE a = ?')
      .all(id) as { b: string; weight: number; last_at: number }[];
    return rows.map((r) => ({
      id: r.b,
      weight: decayedLinkWeight(r.weight, freshLastAt(r.last_at, now), now),
    }));
  }

  /**
   * Two lobes: the left lobe is exact matching (FTS5 + project filter), the right lobe is association
   * (spreading over the link graph). Results merge into one list with RRF and are ranked by strength.
   */
  recall(
    query: string,
    opts: { limit?: number; project?: string; includeDormant?: boolean; hops?: number } = {},
  ): RecalledNote[] {
    const limit = opts.limit ?? 8;
    const hops = opts.hops ?? 1;
    const words = fold(query).split(' ').filter((w) => w.length > 1);
    if (words.length === 0) return [];

    // Turkish suffixes make exact words miss: short stems are tried too.
    const terms = [
      ...new Set(
        words.flatMap((w) =>
          w.length >= 5 ? [w, w.slice(0, 5), w.slice(0, 4)] : w.length >= 4 ? [w, w.slice(0, 4)] : [w],
        ),
      ),
    ];
    const ftsQuery = terms.map((w) => `"${w}"*`).join(' OR ');
    let ranked: { id: string; rank: number }[] = [];
    try {
      ranked = this.db
        .prepare('SELECT id, bm25(memory_fts) AS rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 40')
        .all(ftsQuery) as { id: string; rank: number }[];
    } catch {
      ranked = [];
    }

    const leftOrder = ranked.map((r) => r.id);
    const leftRank = new Map(leftOrder.map((id, index) => [id, index + 1]));

    const rightScore = new Map<string, number>();
    // Candidates from propagation; only those arriving through preload are penalized separately.
    const propagated = new Set<string>();
    for (const seed of leftOrder.slice(0, 10)) {
      let frontier = new Map<string, number>([[seed, 1]]);
      for (let hop = 0; hop < hops; hop++) {
        const next = new Map<string, number>();
        for (const [id, weight] of frontier) {
          for (const link of this.linksOf(id)) {
            if (leftRank.has(link.id) && hop === 0) continue;
            const value = weight * link.weight;
            if (value <= 0) continue;
            next.set(link.id, Math.max(next.get(link.id) ?? 0, value));
          }
        }
        for (const [id, value] of next) {
          rightScore.set(id, Math.max(rightScore.get(id) ?? 0, value));
          propagated.add(id);
        }
        frontier = next;
      }
    }
    // A strongly linked neighbor is a context candidate even without a query word match (single hop,
    // no chain). Written separately: the left-lobe skip at hop=0 does not cut the preload.
    for (const seed of leftOrder.slice(0, 10)) {
      for (const link of this.linksOf(seed)) {
        if (!isStrong(link.weight)) continue;
        rightScore.set(link.id, Math.max(rightScore.get(link.id) ?? 0, link.weight));
      }
    }
    const rightOrder = [...rightScore.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const rightRank = new Map(rightOrder.map((id, index) => [id, index + 1]));

    const candidates = new Set([...leftOrder, ...rightOrder]);
    const results: RecalledNote[] = [];
    for (const id of candidates) {
      const note = this.get(id);
      if (!note || note.forgotten) continue;
      if (!opts.includeDormant && note.dormant) continue;
      // Notes without a project are global; they are visible in every session.
      if (opts.project && note.project !== null && note.project !== opts.project) continue;
      const lobes: ('left' | 'right')[] = [];
      let score = 0;
      const l = leftRank.get(id);
      if (l !== undefined) {
        score += 1 / (RRF_K + l);
        lobes.push('left');
      }
      const r = rightRank.get(id);
      if (r !== undefined) {
        score += 1 / (RRF_K + r);
        lobes.push('right');
      }
      if (lobes.length === 0) continue;
      const value = strength(note);
      // A candidate arriving only through preload cannot beat a real match in the left lobe.
      const preloadOnly = l === undefined && !propagated.has(id);
      const finalScore = score * (0.5 + value) * (preloadOnly ? 0.85 : 1);
      results.push({ ...note, strength: value, score: finalScore, lobes });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Short text that goes into the system context; every line carries a source event id. */
  recallContext(query: string, opts: { limit?: number; project?: string } = {}): { text: string; notes: RecalledNote[] } {
    const notes = this.recall(query, opts);
    if (notes.length === 0) return { text: '', notes };
    const lines = notes.map((n) => {
      const sources = n.evidence.slice(0, 6).join(', ') || 'yok';
      const suffix = n.evidence.length > 6 ? '…' : '';
      return `- ${n.text.slice(0, 400)} [kaynak: ${sources}${suffix}]${n.kind === 'semantic' ? '' : ' (anı)'}`;
    });
    // Keep the context from bloating: the memory section does not exceed 2000 characters.
    return { text: ['## Related memories', ...lines].join('\n').slice(0, 2000), notes };
  }

  /** Writes a conflict edge: the two notes stand side by side, both are marked. */
  markConflict(aId: string, bId: string): void {
    const key = conflictKey(aId, bId);
    if (this.db.prepare('SELECT 1 FROM memory_conflicts WHERE a = ? AND b = ?').get(key[0], key[1])) return;
    this.appendScore(aId, 'conflict', { otherId: bId });
  }

  /** When the user resolves the conflict, the edge is removed. */
  resolveConflict(aId: string, bId?: string): boolean {
    if (!this.get(aId)) return false;
    this.appendScore(aId, 'resolve', bId === undefined ? {} : { otherId: bId });
    return true;
  }

  /** Marked conflict pairs (shown as questions in the UI). */
  conflicts(): { a: Note; b: Note }[] {
    const rows = this.db.prepare('SELECT a, b FROM memory_conflicts').all() as { a: string; b: string }[];
    const pairs: { a: Note; b: Note }[] = [];
    for (const row of rows) {
      const a = this.get(row.a);
      const b = this.get(row.b);
      if (!a || !b || a.forgotten || b.forgotten) continue;
      pairs.push({ a, b });
    }
    return pairs;
  }

  private appendScore(
    id: string,
    op:
      | 'recall'
      | 'correct'
      | 'forget'
      | 'restore'
      | 'supersede'
      | 'dormant'
      | 'wake'
      | 'conflict'
      | 'resolve'
      | 'review'
      | 'trauma',
    extra: Record<string, unknown> = {},
  ): void {
    const event = this.log.append('memory_score', 'brain', 'brain', { noteId: id, op, ...extra });
    this.apply(event);
  }

  private apply(event: StoredEvent): void {
    const payload = event.payload;
    if (event.kind === 'memory_note') {
      const id = String(payload['noteId'] ?? '');
      if (id === '') return;
      this.db
        .prepare(
          `INSERT INTO memory_notes
             (id, kind, text, project, concepts, evidence, base, created_at, stability, difficulty, storage, surprise)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO NOTHING`,
        )
        .run(
          id,
          String(payload['kind'] ?? 'episodic'),
          String(payload['text'] ?? ''),
          (payload['project'] as string | null) ?? null,
          JSON.stringify(payload['concepts'] ?? []),
          JSON.stringify(payload['evidence'] ?? []),
          Number(payload['base'] ?? 0.5),
          Number(payload['createdAt'] ?? event.ts),
          payload['stability'] === undefined ? null : Number(payload['stability']),
          payload['difficulty'] === undefined ? null : Number(payload['difficulty']),
          payload['storage'] === undefined ? null : Number(payload['storage']),
          payload['surprise'] === undefined ? null : Number(payload['surprise']),
        );
      const note = this.get(id);
      if (note) {
        this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id);
        this.db
          .prepare('INSERT INTO memory_fts (id, text, concepts) VALUES (?,?,?)')
          .run(id, fold(note.text), fold(note.concepts.join(' ')));
      }
      return;
    }

    if (event.kind === 'memory_link') {
      const a = String(payload['a'] ?? '');
      const b = String(payload['b'] ?? '');
      const weight = Number(payload['weight'] ?? 0.5);
      // A broken weight is not written; old events lack lastAt, 0 = fresh.
      if (a && b && Number.isFinite(weight) && weight > 0) {
        const lastAt = Number(payload['lastAt']);
        this.applyLink(a, b, weight, Number.isFinite(lastAt) && lastAt > 0 ? lastAt : 0);
      }
      return;
    }

    if (event.kind === 'memory_score') {
      const id = String(payload['noteId'] ?? '');
      const op = String(payload['op'] ?? '');
      const at = Number(payload['at'] ?? event.ts);
      const delta = Number(payload['deltaRecall'] ?? 0);
      if (!id) return;
      if (op === 'recall') {
        this.db
          .prepare('UPDATE memory_notes SET recall_count = recall_count + ?, last_recalled_at = ? WHERE id = ?')
          .run(delta || 1, at, id);
        // Daily refresh: the computed stability is stored in the event (a rebuild yields the same result).
        if (payload['stability'] !== undefined) {
          this.db
            .prepare('UPDATE memory_notes SET stability = ?, last_review = ? WHERE id = ?')
            .run(Number(payload['stability']), Number(payload['lastReview'] ?? at), id);
        }
      } else if (op === 'review') {
        this.db
          .prepare(
            `UPDATE memory_notes
               SET stability = ?, difficulty = ?, storage = ?, last_review = ?
             WHERE id = ?`,
          )
          .run(
            Number(payload['stability'] ?? DEFAULT_STABILITY),
            Number(payload['difficulty'] ?? DEFAULT_DIFFICULTY),
            Math.min(MAX_STORAGE, Number(payload['storage'] ?? DEFAULT_STORAGE)),
            Number(payload['lastReview'] ?? at),
            id,
          );
      } else if (op === 'correct') {
        this.db.prepare('UPDATE memory_notes SET corrected = 1 WHERE id = ?').run(id);
      } else if (op === 'forget') {
        this.db.prepare('UPDATE memory_notes SET forgotten = 1 WHERE id = ?').run(id);
        this.removeConflictEdges(id);
      } else if (op === 'restore') {
        // A restored note is refreshed; otherwise it falls back into cold storage the next day.
        this.db
          .prepare('UPDATE memory_notes SET forgotten = 0, dormant = 0, base = MAX(base, 0.3), created_at = ? WHERE id = ?')
          .run(at, id);
      } else if (op === 'supersede') {
        this.db.prepare('UPDATE memory_notes SET base = MIN(base, 0.2) WHERE id = ?').run(id);
      } else if (op === 'dormant') {
        this.db.prepare('UPDATE memory_notes SET dormant = 1 WHERE id = ?').run(id);
      } else if (op === 'wake') {
        this.db.prepare('UPDATE memory_notes SET dormant = 0 WHERE id = ?').run(id);
      } else if (op === 'conflict') {
        const otherId = String(payload['otherId'] ?? '');
        if (otherId !== '') {
          const [a, b] = conflictKey(id, otherId);
          this.db.prepare('INSERT OR IGNORE INTO memory_conflicts (a, b) VALUES (?,?)').run(a, b);
          this.db.prepare('UPDATE memory_notes SET conflict = 1 WHERE id IN (?,?)').run(a, b);
        }
      } else if (op === 'resolve') {
        const otherId = String(payload['otherId'] ?? '');
        if (otherId !== '') {
          this.removeConflictEdgesPair(id, otherId);
        } else {
          this.removeConflictEdges(id);
        }
        this.refreshConflictFlag(id);
      } else if (op === 'trauma') {
        // A trauma note is permanent: its strength floor is 10, it is recalled out of cold storage.
        this.db
          .prepare('UPDATE memory_notes SET is_trauma = 1, storage = MAX(COALESCE(storage, 10), 10), dormant = 0 WHERE id = ?')
          .run(id);
      }
    }
  }

  private removeConflictEdges(id: string): void {
    this.db.prepare('DELETE FROM memory_conflicts WHERE a = ? OR b = ?').run(id, id);
    this.db.prepare('UPDATE memory_notes SET conflict = 0 WHERE id = ?').run(id);
  }

  private removeConflictEdgesPair(aId: string, bId: string): void {
    const [a, b] = conflictKey(aId, bId);
    this.db.prepare('DELETE FROM memory_conflicts WHERE a = ? AND b = ?').run(a, b);
    this.refreshConflictFlag(aId);
    this.refreshConflictFlag(bId);
  }

  private refreshConflictFlag(id: string): void {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM memory_conflicts WHERE a = ? OR b = ?')
      .get(id, id) as { n: number };
    this.db.prepare('UPDATE memory_notes SET conflict = ? WHERE id = ?').run(row.n > 0 ? 1 : 0, id);
  }

  private applyLink(a: string, b: string, weight: number, lastAt: number): void {
    // Both directions are written with the same weight; the value in the event is applied as is (deterministic replay).
    const upsert = this.db.prepare(
      'INSERT INTO memory_links (a, b, weight, last_at) VALUES (?,?,?,?) ON CONFLICT(a,b) DO UPDATE SET weight = excluded.weight, last_at = excluded.last_at',
    );
    upsert.run(a, b, weight, lastAt);
    upsert.run(b, a, weight, lastAt);
  }
}

/** last_at = 0 rows from the migration count as fresh; they do not rot back to 1970. */
function freshLastAt(lastAt: number, now: number): number {
  return Number.isFinite(lastAt) && lastAt > 0 ? lastAt : now;
}

/** A raw row is untrusted: a NaN/0 weight does not enter the math, a tiny weight is pulled to the floor. */
function decayedLinkWeight(weight: number, lastAt: number, now: number): number {
  const w = Number.isFinite(weight) && weight > 0 ? Math.min(1, weight) : LINK_FLOOR;
  return decayedWeight(w, lastAt, now);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

const NEGATION =
  /(?:^|\s)(?:değil|degil|yok|asla|hiç|hic)(?:\s|$)|(?:ma|me)(?:z|dı|di|mış|miş|yor|yacak|yecek)|m[ıi]yor|m[ae]m[ıi]ş/i;

function hasNegation(text: string): boolean {
  return NEGATION.test(text);
}

/** Do the two texts talk about the same topic: stem-based Jaccard ≥ 0.5 and at least 2 shared stems. */
function shareTopic(a: string, b: string): boolean {
  const stems = (t: string) =>
    new Set(
      fold(t)
        .split(' ')
        .filter((w) => w.length > 3)
        // Turkish suffixes change the word: the first 5 letters count as the stem.
        .map((w) => w.slice(0, 5)),
    );
  const wa = stems(a);
  const wb = stems(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  if (shared < 2) return false;
  const union = wa.size + wb.size - shared;
  return shared / union >= 0.5;
}

function conflictKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function sessionOf(input: NoteInput): string {
  return input.project ? `project:${input.project}` : 'brain';
}
