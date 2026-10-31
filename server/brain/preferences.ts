import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fold } from '../memory/notes.js';
import { TR_STOP_WORDS } from './stopwords.js';

/** Proposal threshold: a preference is only asked after it appears in this many distinct messages. */
export const PREFERENCE_THRESHOLD = 15;

/** A word must appear in at least this many distinct messages to be a candidate. */
const MIN_MESSAGES = 3;

/** At least this many of those messages must read like a preference sentence. */
const MIN_CUE_MESSAGES = 2;

/**
 * Preference cues: searched as substrings in the `fold`ed message. Not a
 * dictionary, but the language's preference patterns: "use", "prefer", "love",
 * "no longer", "instead of", "install", "write". Filters out free prose
 * (weather, errands, coffee).
 */
export const PREFERENCE_CUES: readonly string[] = [
  'kullan', 'tercih', 'sev', 'hep', 'artik', 'yerine', 'gec', 'calis', 'dene',
  'deniyor', 'kur', 'yaz', 'kullaniyorum',
];

/**
 * Extras specific to the preference counter: chat filler beyond the shared
 * `TR_STOP_WORDS`. Keys are in `fold` form (ASCII, lowercase).
 */
const EXTRA_STOP_WORDS = [
  'acaba', 'aksam', 'ancak', 'artik', 'az', 'bana', 'bence', 'belki',
  'benden', 'beni', 'bile', 'biraz', 'biri', 'birsey', 'bize', 'bizi',
  'buna', 'bunu', 'bunun', 'bunlar', 'da', 'de', 'defa', 'denedim', 'diye',
  'eder', 'ediyorum', 'en', 'et', 'ettim', 'fakat', 'gece', 'gun', 'gunaydin',
  'hangi', 'hava', 'her', 'hersey', 'hic', 'hala', 'ise', 'isler', 'kez',
  'ki', 'kim', 'kullan', 'kullandik', 'kullandim', 'kullaniyorum', 'kullanmak',
  'mi', 'mu', 'nasilsin', 'nerede', 'niye', 'olarak', 'olan', 'olsun', 'onu',
  'onun', 'peki', 'sabah', 'sadece', 'sana', 'selamlar', 'seni', 'simdi',
  'sunu', 'seyler', 'size', 'sizin', 'tane', 'tesekkurler', 'veya', 'yani',
  'yapar', 'yine',
];

/**
 * Words that cannot be candidates: the `fold` form of the shared list + counter
 * extras. The list lives in one place (`stopwords.ts`) and is not copied here.
 */
export const PREFERENCE_STOP_WORDS: ReadonlySet<string> = new Set([
  ...TR_STOP_WORDS.map(fold),
  ...EXTRA_STOP_WORDS,
]);

/**
 * Deterministic preference candidates from the last 30 days of real user messages.
 *
 * Structural gate: a word must appear in at least 3 distinct messages and at
 * least 2 of those must carry a preference cue. Prose ("nice weather", "let's
 * grab coffee") is dropped because it carries no cue; the stop-word list is
 * only the second, cheap filter. Repeats within one message count once; the
 * `now` window is applied by the caller.
 */
export function preferenceCounts(userMessages: string[], now?: number): { key: string; count: number }[] {
  void now;
  const counts = new Map<string, number>();
  const cueCounts = new Map<string, number>();
  for (const message of userMessages) {
    const folded = fold(message);
    const hasCue = PREFERENCE_CUES.some((cue) => folded.includes(cue));
    const words = new Set(
      folded
        .split(/\s+/)
        .filter((word) => word.length >= 2 && !PREFERENCE_STOP_WORDS.has(word)),
    );
    for (const word of words) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
      if (hasCue) cueCounts.set(word, (cueCounts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([word, count]) => count >= MIN_MESSAGES && (cueCounts.get(word) ?? 0) >= MIN_CUE_MESSAGES)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * Small UI state holding the keys already offered. Not written to the event log:
 * this is not memory, just a ledger of "I already asked this question".
 */
export class PreferenceStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, 'preferences.json');
  }

  /**
   * A key past the threshold and not offered before; READ ONLY.
   * The offer becomes durable only via `markOffered` after the turn succeeds.
   */
  peekOffer(candidates: { key: string; count: number }[]): string | null {
    const offered = this.read();
    const ordered = [...candidates].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    for (const candidate of ordered) {
      if (candidate.count < PREFERENCE_THRESHOLD) continue;
      if (offered[candidate.key] !== undefined) continue;
      return candidate.key;
    }
    return null;
  }

  /** Written after the offer is delivered: a failed turn does not burn the offer. */
  markOffered(key: string, count: number): void {
    const offered = this.read();
    offered[key] = count;
    this.write(offered);
  }

  offered(): string[] {
    return Object.keys(this.read());
  }

  /** A corrupt file is treated as empty: the offer ledger must not drop the turn. */
  private read(): Record<string, number> {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const out: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
      }
      return out;
    } catch {
      return {};
    }
  }

  /** Atomic write; errors are swallowed (a missing ledger must not break the reply). */
  private write(value: Record<string, number>): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
      renameSync(tmp, this.path);
    } catch {
      // swallowed
    }
  }
}

/**
 * Prompt hint: at most one line; the model does not write a rule, it asks the user.
 * A long key is truncated, the question sentence stays whole.
 */
export function preferenceHint(key: string, count: number): string {
  const shown = key.length > 40 ? `${key.slice(0, 40)}…` : key;
  return `You use "${shown}" often (${count} times). Should I add it to my permanent rules?`;
}
