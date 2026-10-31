import { createHash } from 'node:crypto';
import type { MemoryStore, Note } from './notes.js';

export const INTUITION_MIN_AGE_DAYS = 90;
/** Persistence limit: the same line as `shouldGoDormant` (storage < 3 goes cold). */
export const INTUITION_MIN_STORAGE = 3;
export const INTUITION_MIN_NOTES = 2;

/** Prompt line limits: the concept is LLM output, it cannot grow the line. */
const MAX_CONCEPT_CHARS = 40;
const MAX_LINE_CONCEPTS = 6;
const MAX_LINE_SOURCES = 4;
const MAX_LINE_CHARS = 300;

export type Intuition = {
  id: string; // kavram kümesinden türetilir (deterministik)
  concepts: string[];
  caution: number; // 0..1 — travma komşuluğu
  confidence: number; // 0..1 — kaynak not sayısı
  sourceNotes: string[];
  createdAt: number;
};

const DAY = 86_400_000;

/**
 * Intuition is not persistent: it is rebuilt from notes on every call.
 * Candidate: a note that is not forgotten, at least 90 days old and has storage strength >= 3.
 * Grouping is done by signature (not connected component): notes carrying the same
 * strong concept set become one intuition, so confidence really reflects the note count.
 */
export function buildIntuitions(memory: MemoryStore, now = Date.now()): Intuition[] {
  // Single query: no per-note read (runs once per turn).
  const notes = memory
    .list({ includeDormant: true })
    .filter((n) => !n.forgotten && n.storage >= INTUITION_MIN_STORAGE && now - n.createdAt >= INTUITION_MIN_AGE_DAYS * DAY);

  // 1) Strong concepts: those appearing in at least 2 notes. 2) Note key: the strong concept set.
  const counts = new Map<string, number>();
  const display = new Map<string, string>();
  for (const note of notes) {
    for (const key of noteKeys(note)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!display.has(key)) display.set(key, note.concepts.find((c) => conceptKey(c) === key) ?? key);
    }
  }

  const groups = new Map<string, Note[]>();
  const groupKeys = new Map<string, string[]>();
  for (const note of notes) {
    const key = noteKeys(note).filter((k) => (counts.get(k) ?? 0) >= 2);
    if (key.length === 0) continue;
    const signature = key.join('|');
    const group = groups.get(signature) ?? [];
    group.push(note);
    groups.set(signature, group);
    groupKeys.set(signature, key);
  }

  const intuitions: Intuition[] = [];
  for (const [signature, group] of groups) {
    if (group.length < INTUITION_MIN_NOTES) continue;
    const key = groupKeys.get(signature) as string[];
    intuitions.push({
      id: intuitionId(key),
      concepts: key.map((k) => display.get(k) ?? k),
      caution: group.some((n) => n.isTrauma) ? 0.8 : 0.2,
      confidence: Math.min(1, 0.4 + 0.15 * group.length),
      sourceNotes: group.map((n) => n.id).sort(),
      // reduce: `Math.max(...)` would blow the stack on a large group (RangeError).
      createdAt: group.reduce((latest, n) => Math.max(latest, n.createdAt), 0),
    });
  }

  // Deterministic order: most confident first, then most cautious.
  return intuitions.sort((a, b) => b.confidence - a.confidence || b.caution - a.caution || (a.id < b.id ? -1 : 1));
}

/**
 * The first `limit` intuitions intersecting the query. A concept may be several words: the line
 * is included if any word of the concept matches a word of the query.
 * Matching is set equality (not substring), so 2-letter concepts like `ai` match
 * safely; the 1-letter `c` is excluded so it does not stick to every query.
 * Concepts with symbols like `c++`/`c#` do not hit the length gate.
 */
export function intuitionLine(intuitions: Intuition[], query: string, limit = 3): string {
  const wanted = matchTokens(query);
  const max = Math.max(0, limit);
  if (wanted.size === 0 || max === 0) return '';
  const lines: string[] = [];
  for (const intuition of intuitions) {
    if (lines.length >= max) break;
    if (!intuition.concepts.some((c) => [...matchTokens(c)].some((t) => wanted.has(t)))) continue;
    lines.push(formatLine(intuition));
  }
  return lines.join('\n');
}

/** Concepts, numbers and source ids; the note text never enters. */
function formatLine(intuition: Intuition): string {
  const concepts = [...new Set(intuition.concepts.map((c) => clean(c, MAX_CONCEPT_CHARS)).filter((c) => c !== ''))];
  const shown = concepts.slice(0, MAX_LINE_CONCEPTS);
  const conceptText = shown.join('/') + (concepts.length > MAX_LINE_CONCEPTS ? '…' : '');
  const sources = intuition.sourceNotes.map((id) => clean(id, 64)).filter((id) => id !== '').slice(0, MAX_LINE_SOURCES);
  const line = `- intuition: ${conceptText} (confidence ${intuition.confidence.toFixed(2)}, caution ${intuition.caution.toFixed(
    2,
  )}, ${intuition.sourceNotes.length} memories) [source: ${sources.join(' ')}]`;
  return line.slice(0, MAX_LINE_CHARS);
}

/**
 * Grouping key: unlike `fold`, `+`, `#`, `.`, `-` are preserved, otherwise
 * `c`, `c++` and `c#` would collapse into the same concept. `ı`/`İ` still become `i`.
 */
export function conceptKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}\s+#.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text that goes to the prompt: control characters are flattened, length is capped. */
function clean(value: string, max: number): string {
  const flat = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

function noteKeys(note: Note): string[] {
  return [...new Set(note.concepts.map(conceptKey).filter((k) => k !== ''))].sort();
}

function matchTokens(value: string): Set<string> {
  return new Set(
    conceptKey(value)
      .split(' ')
      // 2 letters is enough: matching is set equality, not substring.
      .filter((t) => t !== '' && (t.length >= 2 || /[+#]/.test(t))),
  );
}

function intuitionId(keys: string[]): string {
  return 'intuition:' + createHash('sha1').update(keys.join('|')).digest('hex').slice(0, 12);
}
