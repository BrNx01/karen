import type Database from 'better-sqlite3';
import { fold, type MemoryStore } from './notes.js';
import type { EventLog, StoredEvent } from '../store/events.js';

export type FactKind = 'number' | 'money' | 'date' | 'duration' | 'percent' | 'count' | 'text';

export type Fact = {
  id: string;
  entity: string;
  attribute: string;
  kind: FactKind;
  valueNum: number | null;
  valueText: string;
  unit: string | null;
  sourceEvent: number;
  validFrom: number;
  /** Bi-temporal model: the moment validity ends. `null` = still valid. */
  validTo: number | null;
  /** Id of the new fact that superseded this fact. */
  supersededBy: string | null;
};

export type ActionRecord = {
  id: string;
  tool: string;
  target: string;
  status: 'ok' | 'failed' | 'denied';
  summary: string;
  at: number;
  durationMs: number | null;
  sourceEvent: number;
};

export type ComputeOp = 'sum' | 'count' | 'latest' | 'earliest' | 'next' | 'avg';

export type ComputeResult = {
  op: ComputeOp;
  attribute: string;
  entity?: string;
  value: number | null;
  at?: number;
  matched: number;
  sourceEvents: number[];
  /** Reason when no result could be given (ambiguous unit, no future record…). */
  reason?: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS world_facts (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  attribute TEXT NOT NULL,
  kind TEXT NOT NULL,
  value_num REAL,
  value_text TEXT NOT NULL,
  unit TEXT,
  source_event INTEGER NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  superseded_by TEXT
);
CREATE INDEX IF NOT EXISTS world_facts_attr ON world_facts(attribute, entity);
CREATE TABLE IF NOT EXISTS world_actions (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  at INTEGER NOT NULL,
  duration_ms INTEGER,
  source_event INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL
);
`;

/** Units and their normalization factors. */
const UNITS: { unit: string; pattern: RegExp; kind: FactKind; factor: number }[] = [
  { unit: 'TL', pattern: /(\d[\d.,]*)\s*(?:tl|₺|lira)(?![a-zçğıöşü])/i, kind: 'money', factor: 1 },
  { unit: 'USD', pattern: /(\d[\d.,]*)\s*(?:\$|usd|dolar)(?![a-zçğıöşü])/i, kind: 'money', factor: 1 },
  { unit: 'EUR', pattern: /(\d[\d.,]*)\s*(?:€|eur|euro)(?![a-zçğıöşü])/i, kind: 'money', factor: 1 },
  { unit: '%', pattern: /%(\d[\d.,]*)|(\d[\d.,]*)\s*(?:%|yüzde)/i, kind: 'percent', factor: 1 },
  { unit: 'saat', pattern: /(\d[\d.,]*)\s*(?:saat|sa)(?![a-zçğıöşü])/i, kind: 'duration', factor: 3600_000 },
  { unit: 'dakika', pattern: /(\d[\d.,]*)\s*(?:dakika|dk)(?![a-zçğıöşü])/i, kind: 'duration', factor: 60_000 },
  { unit: 'gün', pattern: /(\d[\d.,]*)\s*gün/i, kind: 'duration', factor: 86_400_000 },
  { unit: 'MB', pattern: /(\d[\d.,]*)\s*mb(?![a-z])/i, kind: 'number', factor: 1 },
  { unit: 'GB', pattern: /(\d[\d.,]*)\s*gb(?![a-z])/i, kind: 'number', factor: 1024 },
];

const TIME_PATTERN = /\b([01]?\d|2[0-3]):([0-5]\d)(?![0-9])/;
const DATE_PATTERN = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})(?![0-9])/;

/**
 * Attribute whitelist: we do not treat every number as a fact.
 * Note: JS `\b` does not treat Turkish letters (ı, ş, ğ…) as word characters; so the
 * boundary check is done with `(?![a-zçğıöşü])`.
 */
const ATTRIBUTE_HINTS: { attribute: string; re: RegExp }[] = [
  { attribute: 'aylık bütçe', re: /(?:^|[^a-zçğıöşü])(bütçe|budget)(?![a-zçğıöşü])/i },
  { attribute: 'fiyat', re: /(?:^|[^a-zçğıöşü])(fiyat|ücret|maliyet|tutar|price|cost)(?![a-zçğıöşü])/i },
  { attribute: 'süre', re: /(?:^|[^a-zçğıöşü])(süre|bekleme|timeout|zaman aşımı)(?![a-zçğıöşü])/i },
  { attribute: 'yedek saati', re: /(?:^|[^a-zçğıöşü])(yedek|backup)(?![a-zçğıöşü])/i },
  { attribute: 'toplantı', re: /(?:^|[^a-zçğıöşü])(toplantı|meeting)(?![a-zçğıöşü])/i },
  { attribute: 'oran', re: /(?:^|[^a-zçğıöşü])(oran|yüzde|percent|%)(?![a-zçğıöşü])/i },
  { attribute: 'boyut', re: /(?:^|[^a-zçğıöşü])(boyut|size|mb|gb)(?![a-zçğıöşü])/i },
  { attribute: 'sıklık', re: /(?:^|[^a-zçğıöşü])(her|günde|haftada|ayda)(?![a-zçğıöşü])/i },
];
/** Turkish/English number format: 1.500,50 → 1500.5 · 1,500.50 → 1500.5 · 12,5 → 12.5 */
export function parseNumber(raw: string): number {
  const text = raw.trim();
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    // The last separator seen is the decimal one.
    return text.lastIndexOf(',') > text.lastIndexOf('.')
      ? Number(text.replace(/\./g, '').replace(',', '.'))
      : Number(text.replace(/,/g, ''));
  }
  if (hasComma) {
    const parts = text.split(',');
    // 1,500 → thousands separator (3 digits and a single comma), 12,5 → decimal.
    if (parts.length === 2 && (parts[1] ?? '').length === 3 && (parts[0] ?? '').length <= 3 && /^\d{3}$/.test(parts[1] ?? '')) {
      return Number(text.replace(',', ''));
    }
    return Number(text.replace(',', '.'));
  }
  if (hasDot) {
    const parts = text.split('.');
    if (parts.length > 2) return Number(text.replace(/\./g, ''));
    if (/^\d{3}$/.test(parts[1] ?? '') && (parts[0] ?? '').length <= 3) return Number(text.replace('.', ''));
    return Number(text);
  }
  return Number(text);
}

/**
 * Extracts typed facts from text. Only values that appear VERBATIM in the text are taken;
 * a whitelist is checked for the attribute, and no row is produced without a match.
 */
export function extractFacts(text: string, entity: string, sourceEvent: number, now = Date.now()): Fact[] {
  const facts: Fact[] = [];
  const hint = ATTRIBUTE_HINTS.find((h) => h.re.test(text));

  const found: { unit: string; kind: FactKind; value: number; text: string; factor: number }[] = [];
  for (const def of UNITS) {
    const match = def.pattern.exec(text);
    const raw = match?.[1] ?? match?.[2];
    if (!match || raw === undefined) continue;
    const value = parseNumber(raw);
    if (!Number.isFinite(value)) continue;
    found.push({ unit: def.unit, kind: def.kind, value, text: match[0].trim(), factor: def.factor });
  }

  // If the sentence has a single kind, the sentence's topic is that kind; if there are several,
  // writing the sentence heading on all of them would produce a wrong total (500 TL + 15% + 2 hours).
  const timeMatch = TIME_PATTERN.exec(text);
  const dateMatch = DATE_PATTERN.exec(text);
  const kinds = new Set(found.map((f) => f.kind));
  if (timeMatch || dateMatch) kinds.add('date');
  const singleKind = kinds.size === 1;

  for (const item of found) {
    facts.push({
      id: `${sourceEvent}:${item.unit}:${item.value}`,
      entity,
      attribute: singleKind && hint ? hint.attribute : item.kind,
      kind: item.kind,
      valueNum: item.value * item.factor,
      valueText: item.text,
      unit: item.unit,
      sourceEvent,
      validFrom: now,
      validTo: null,
      supersededBy: null,
    });
  }

  const time = timeMatch;
  if (time) {
    const [hour, minute] = [Number(time[1]), Number(time[2])];
    facts.push({
      id: `${sourceEvent}:time:${hour}:${minute}`,
      entity,
      attribute: singleKind && hint ? hint.attribute : 'saat',
      kind: 'date',
      valueNum: hour * 60 + minute,
      valueText: time[0],
      unit: 'saat:dakika',
      sourceEvent,
      validFrom: now,
      validTo: null,
      supersededBy: null,
    });
  }

  const date = dateMatch;
  if (date) {
    const [day, month, year] = [Number(date[1]), Number(date[2]), Number(date[3])];
    // Calendar validation: 45.13.2026 is not a real date.
    const at = Date.UTC(year, month - 1, day);
    const check = new Date(at);
    const valid =
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day;
    if (valid) {
      facts.push({
        id: `${sourceEvent}:date:${day}.${month}.${year}`,
        entity,
        attribute: singleKind && hint ? hint.attribute : 'tarih',
        kind: 'date',
        valueNum: at,
        valueText: date[0],
        unit: 'tarih',
        sourceEvent,
        validFrom: now,
        validTo: null,
        supersededBy: null,
      });
    }
  }

  return facts;
}

export class WorldModel {
  private readonly db: Database.Database;

  constructor(
    private readonly log: EventLog,
    private readonly memory: MemoryStore,
  ) {
    this.db = log.database;
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Adds the bi-temporal columns to old databases. */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(world_facts)').all() as { name: string }[];
    const has = (name: string) => columns.some((c) => c.name === name);
    if (!has('valid_to')) this.db.exec('ALTER TABLE world_facts ADD COLUMN valid_to INTEGER');
    if (!has('superseded_by')) this.db.exec('ALTER TABLE world_facts ADD COLUMN superseded_by TEXT');
  }

  /** Rebuilds the projection from the event log. */
  rebuild(): void {
    this.db.exec('DELETE FROM world_facts; DELETE FROM world_actions; DELETE FROM world_entities;');
    for (const event of this.log.read()) this.apply(event);
  }

  rememberFact(fact: Omit<Fact, 'id'> & { id?: string }): Fact {
    const id = fact.id ?? `${fact.sourceEvent}:${fact.attribute}:${fact.valueText}`;
    const stored: Fact = { ...fact, id };
    this.log.append('memory_note', 'brain', 'brain', { world: true, ...stored });
    this.insertFact(stored);
    return stored;
  }

  /** During distillation: writes the typed facts in the text and returns their count. */
  extractFromText(text: string, entity: string, sourceEvent: number, now = Date.now()): Fact[] {
    const facts = extractFacts(text, entity, sourceEvent, now);
    const inserted: Fact[] = [];
    for (const fact of facts) {
      if (this.getFact(fact.id)) continue;
      // Bi-temporal model (decision 12.8): an old fact is not deleted, it is superseded —
      // but only if there is a real attribute name and the same kind/unit.
      const previous = this.currentFactFor(fact, now);
      this.log.append('memory_note', 'brain', 'brain', { world: true, ...fact });
      this.insertFact(fact);
      if (previous && previous.id !== fact.id) this.supersede(previous.id, fact.id, now);
      inserted.push(fact);
    }
    return inserted;
  }

  /** The fact still valid under the same entity + real attribute + kind + unit. */
  private currentFactFor(fact: Fact, now: number): Fact | null {
    // The kind fallback ("money", "date"…) does not count as a real attribute name: they live side by side.
    if (fact.attribute === fact.kind) return null;
    const rows = this.facts({ entity: fact.entity, limit: 200 }).filter(
      (row) =>
        row.id !== fact.id &&
        row.validTo === null &&
        row.validFrom <= now &&
        row.attribute === fact.attribute &&
        row.kind === fact.kind &&
        (row.unit ?? '') === (fact.unit ?? ''),
    );
    return rows[0] ?? null;
  }

  /** Supersedes the old fact: it does not delete it, it writes `valid_to` and links it to the new one. */
  private supersede(factId: string, newFactId: string, at: number): void {
    this.log.append('memory_note', 'brain', 'brain', {
      worldSupersede: true,
      factId,
      supersededBy: newFactId,
      validTo: at,
    });
    this.applySupersede(factId, newFactId, at);
  }

  /** Writes tool runs into the action history. */
  recordAction(action: Omit<ActionRecord, 'id'> & { id?: string }): ActionRecord {
    const id = action.id ?? `${action.sourceEvent}:${action.tool}:${action.at}`;
    const stored: ActionRecord = { ...action, id };
    this.log.append('memory_note', 'brain', 'brain', { worldAction: true, ...stored });
    this.insertAction(stored);
    return stored;
  }

  facts(
    query: {
      entity?: string;
      attribute?: string;
      kind?: FactKind;
      since?: number;
      limit?: number;
      /** Look at a past moment: the facts valid at that time. */
      asOf?: number;
      includeHistory?: boolean;
    } = {},
  ): Fact[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.entity) {
      clauses.push('entity = ?');
      params.push(query.entity);
    }
    if (query.attribute) {
      clauses.push('attribute LIKE ?');
      params.push(`%${query.attribute}%`);
    }
    if (query.kind) {
      clauses.push('kind = ?');
      params.push(query.kind);
    }
    if (query.since !== undefined) {
      clauses.push('valid_from >= ?');
      params.push(query.since);
    }
    if (query.asOf !== undefined) {
      // Valid at that moment: started later AND has not ended (valid_to exclusive).
      clauses.push('valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)');
      params.push(query.asOf, query.asOf);
    } else if (query.includeHistory !== true) {
      clauses.push('valid_to IS NULL');
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM world_facts ${where} ORDER BY valid_from DESC LIMIT ?`)
      .all(...params, query.limit ?? 50) as {
      id: string;
      entity: string;
      attribute: string;
      kind: FactKind;
      value_num: number | null;
      value_text: string;
      unit: string | null;
      source_event: number;
      valid_from: number;
      valid_to: number | null;
      superseded_by: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      entity: row.entity,
      attribute: row.attribute,
      kind: row.kind,
      valueNum: row.value_num,
      valueText: row.value_text,
      unit: row.unit,
      sourceEvent: row.source_event,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      supersededBy: row.superseded_by,
    }));
  }

  history(limit = 20): ActionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM world_actions ORDER BY at DESC LIMIT ?')
      .all(limit) as {
      id: string;
      tool: string;
      target: string;
      status: ActionRecord['status'];
      summary: string;
      at: number;
      duration_ms: number | null;
      source_event: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      tool: row.tool,
      target: row.target,
      status: row.status,
      summary: row.summary,
      at: row.at,
      durationMs: row.duration_ms,
      sourceEvent: row.source_event,
    }));
  }

  /**
   * Deterministic computation. No fabrication: every result is derived from fact rows and
   * their source events.
   *
   * If units/kinds are mixed we do not give a total (like 500 TL + 15%) — it returns "ambiguous".
   */
  compute(op: ComputeOp, attribute: string, entity?: string, opts: { includeHistory?: boolean } = {}): ComputeResult {
    const rows = this.facts({ attribute, ...(entity === undefined ? {} : { entity }), limit: 5000 });
    const base: ComputeResult = {
      op,
      attribute,
      ...(entity === undefined ? {} : { entity }),
      value: null,
      matched: rows.length,
      sourceEvents: rows.map((f) => f.sourceEvent),
    };
    if (rows.length === 0) return base;
    if (op === 'count') return { ...base, value: rows.length };

    // Historical rows are not summed: we would produce a total that was never true (decision 12.8).
    if (opts.includeHistory && (op === 'sum' || op === 'avg')) {
      return { ...base, reason: 'historical rows cannot be summed' };
    }

    const numbers = rows.filter((f) => f.valueNum !== null);
    if (op === 'sum' || op === 'avg') {
      const groups = new Set(numbers.map((f) => `${f.kind}:${f.unit ?? ''}`));
      if (groups.size > 1) {
        return { ...base, reason: 'ambiguous: mixed kinds/units' };
      }
      const values = numbers.map((f) => f.valueNum as number);
      if (values.length === 0) return base;
      const total = values.reduce((a, b) => a + b, 0);
      return { ...base, value: op === 'sum' ? total : total / values.length };
    }

    // Time operations: date (epoch) and time (minute of day) are evaluated separately.
    const dates = rows.filter((f) => f.unit === 'tarih' && f.valueNum !== null);
    const times = rows.filter((f) => f.unit === 'saat:dakika' && f.valueNum !== null);
    const now = Date.now();
    const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();

    if (op === 'next') {
      const futureDates = dates.filter((f) => (f.valueNum as number) > now).sort((a, b) => (a.valueNum ?? 0) - (b.valueNum ?? 0));
      if (futureDates[0]) {
        return { ...base, value: futureDates[0].valueNum, at: futureDates[0].validFrom, sourceEvents: [futureDates[0].sourceEvent] };
      }
      const futureTimes = times.filter((f) => (f.valueNum as number) > nowMinutes).sort((a, b) => (a.valueNum ?? 0) - (b.valueNum ?? 0));
      if (futureTimes[0]) {
        return { ...base, value: futureTimes[0].valueNum, at: futureTimes[0].validFrom, sourceEvents: [futureTimes[0].sourceEvent] };
      }
      return { ...base, reason: 'no records in the future' };
    }

    const pool = dates.length > 0 ? dates : times;
    if (pool.length === 0) return base;
    const sorted = [...pool].sort((a, b) => (a.valueNum ?? 0) - (b.valueNum ?? 0));
    const pick = op === 'earliest' ? sorted[0] : sorted[sorted.length - 1];
    return { ...base, value: pick?.valueNum ?? null, at: pick?.validFrom, sourceEvents: [pick?.sourceEvent ?? 0] };
  }

 /** A free note for information that cannot be extracted from text but was told to the model. */
  private getFact(id: string): Fact | null {
    const row = this.db.prepare('SELECT * FROM world_facts WHERE id = ?').get(id) as
      | {
          id: string;
          entity: string;
          attribute: string;
          kind: FactKind;
          value_num: number | null;
          value_text: string;
          unit: string | null;
          source_event: number;
          valid_from: number;
          valid_to: number | null;
          superseded_by: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      entity: row.entity,
      attribute: row.attribute,
      kind: row.kind,
      valueNum: row.value_num,
      valueText: row.value_text,
      unit: row.unit,
      sourceEvent: row.source_event,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      supersededBy: row.superseded_by,
    };
  }

  private insertFact(fact: Fact): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO world_facts
         (id, entity, attribute, kind, value_num, value_text, unit, source_event, valid_from, valid_to, superseded_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        fact.id,
        fact.entity,
        fact.attribute,
        fact.kind,
        fact.valueNum,
        fact.valueText,
        fact.unit,
        fact.sourceEvent,
        fact.validFrom,
        fact.validTo ?? null,
        fact.supersededBy ?? null,
      );
  }

  private applySupersede(factId: string, newFactId: string, at: number): void {
    this.db.prepare('UPDATE world_facts SET valid_to = ?, superseded_by = ? WHERE id = ?').run(at, newFactId, factId);
  }

  private insertAction(action: ActionRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO world_actions
         (id, tool, target, status, summary, at, duration_ms, source_event)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        action.id,
        action.tool,
        action.target,
        action.status,
        action.summary,
        action.at,
        action.durationMs,
        action.sourceEvent,
      );
  }

  /** Applies a log event to the projection (rebuild and live writes use the same path). */
  private apply(event: StoredEvent): void {
    const p = event.payload;
    if (p['world'] === true) {
      this.insertFact({
        id: String(p['id'] ?? ''),
        entity: String(p['entity'] ?? ''),
        attribute: String(p['attribute'] ?? ''),
        kind: String(p['kind'] ?? 'text') as FactKind,
        valueNum: typeof p['valueNum'] === 'number' ? p['valueNum'] : null,
        valueText: String(p['valueText'] ?? ''),
        unit: typeof p['unit'] === 'string' ? p['unit'] : null,
        sourceEvent: Number(p['sourceEvent'] ?? event.id),
        validFrom: Number(p['validFrom'] ?? event.ts),
        validTo: typeof p['validTo'] === 'number' ? p['validTo'] : null,
        supersededBy: typeof p['supersededBy'] === 'string' ? p['supersededBy'] : null,
      });
      return;
    }
    if (p['worldSupersede'] === true) {
      this.applySupersede(
        String(p['factId'] ?? ''),
        String(p['supersededBy'] ?? ''),
        Number(p['validTo'] ?? event.ts),
      );
      return;
    }
    if (p['worldAction'] === true) {
      this.insertAction({
        id: String(p['id'] ?? ''),
        tool: String(p['tool'] ?? ''),
        target: String(p['target'] ?? ''),
        status: String(p['status'] ?? 'ok') as ActionRecord['status'],
        summary: String(p['summary'] ?? ''),
        at: Number(p['at'] ?? event.ts),
        durationMs: typeof p['durationMs'] === 'number' ? p['durationMs'] : null,
        sourceEvent: Number(p['sourceEvent'] ?? event.id),
      });
    }
  }

  /** Summary: a short world state for the system context. */
  context(limit = 8): string {
    const facts = this.facts({ limit });
    const actions = this.history(limit);
    if (facts.length === 0 && actions.length === 0) return '';
    const lines: string[] = ['## World model'];
    for (const fact of facts) {
      lines.push(`- ${fact.entity}: ${fact.attribute} = ${fact.valueText} [source: ${fact.sourceEvent}]`);
    }
    for (const action of actions.slice(0, 4)) {
      lines.push(`- action: ${action.tool} → ${action.status} (${action.summary.slice(0, 80)})`);
    }
    return lines.join('\n').slice(0, 1500);
  }

  /** Normalizes the search query key (Turkish suffixes). */
  static normalize(text: string): string {
    return fold(text);
  }

  /**
   * Projects new events in the log onto the world model: tool results → action,
   * user messages → typed fact. Deterministic; no model call.
   * Return value: the last event id processed.
   */
  syncFromLog(fromEventId: number, opts: { entityOf?: (sessionId: string) => string } = {}): number {
    let last = fromEventId;
    let events: StoredEvent[] = [];
    try {
      // Incremental read: we do not re-parse the whole log every turn.
      events = this.log.readSince(fromEventId);
    } catch {
      return fromEventId;
    }
    for (const event of events) {
      last = Math.max(last, event.id);
      if (event.kind === 'tool_result') {
        const tool = String(event.payload['tool'] ?? '');
        if (tool === '') continue;
        const ok = event.payload['ok'] === true;
        const summary = (event.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        const id = `act:${event.id}`;
        if (this.historyContains(id)) continue;
        this.log.append('memory_note', 'brain', 'brain', {
          worldAction: true,
          id,
          tool,
          target: event.sessionId,
          status: ok ? 'ok' : 'failed',
          summary: summary || (ok ? 'ok' : 'failed'),
          at: event.ts,
          durationMs: null,
          sourceEvent: event.id,
        });
        this.insertAction({
          id,
          tool,
          target: event.sessionId,
          status: ok ? 'ok' : 'failed',
          summary: summary || (ok ? 'ok' : 'failed'),
          at: event.ts,
          durationMs: null,
          sourceEvent: event.id,
        });
        continue;
      }

      if (event.kind === 'message' && event.payload['role'] === 'user') {
        const body = event.body ?? '';
        if (body.trim() === '') continue;
        const entity = opts.entityOf?.(event.sessionId) ?? event.sessionId;
        this.extractFromText(body, entity, event.id, event.ts);
      }
    }
    return last;
  }

  private historyContains(id: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM world_actions WHERE id = ?').get(id);
    return row !== undefined;
  }
}
