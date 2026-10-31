import { fold, type MemoryStore } from './notes.js';

export type TraumaHit = { noteId: string; reason: 'repeated error' | 'harsh correction' | 'user' };
export const REPEAT_THRESHOLD = 3;
/** A note must share at least this much of the words of the related error message. */
const OVERLAP_THRESHOLD = 0.6;
/** Harsh correction threshold: a correction above this cortisol is trauma. */
const HARSH_CORTISOL = 0.6;
/**
 * A single-word message would make everything trauma (trauma does not decay and is irreversible):
 * at least two distinct words are required, and at least two words must be shared.
 */
const MIN_MESSAGE_WORDS = 2;
const MIN_SHARED_WORDS = 2;

type DetectionInput = {
  notes: {
    id: string;
    text: string;
    /** Did the note already exist when the error occurred: trauma does not apply retroactively. */
    createdAt: number;
    project: string | null;
    isTrauma: boolean;
    /** The user superseded this note; the repeated-error path does not mark it. */
    superseded: boolean;
  }[];
  /** Without `ts` and `project` an error is treated as timeless/global (not in favor of a wrong mark). */
  errors: { message: string; ts?: number; project?: string | null }[];
  corrections: { noteId: string; cortisol: number }[];
};

/** Turkish-folded word set: `fold` closes the İ/ı difference too. */
function words(text: string): Set<string> {
  return new Set(fold(text).split(' ').filter((w) => w !== ''));
}

/** Deterministic detection. Same input, same output; no model call, clock or randomness. */
export function detectTrauma(input: DetectionInput): TraumaHit[] {
  // Repeated error messages: words are sorted so a different ordering of the same message does not split the count.
  // The project also enters the key: the same error in two projects is not counted once and spilled into the wrong project.
  const groups = new Map<string, { words: Set<string>; count: number; ts: number; project: string | null }>();
  for (const error of input.errors) {
    const key = [...words(error.message)].sort().join(' ');
    if (key === '') continue;
    const project = typeof error.project === 'string' ? error.project : null;
    const ts = Number.isFinite(error.ts) ? (error.ts as number) : 0;
    const id = `${project ?? ''}|${key}`;
    const group = groups.get(id);
    if (group) {
      group.count++;
      // The LAST time of the error group: the note must have existed by then.
      group.ts = Math.max(group.ts, ts);
    } else {
      groups.set(id, { words: new Set(key.split(' ')), count: 1, ts, project });
    }
  }
  const repeated = [...groups.values()].filter(
    (group) => group.count >= REPEAT_THRESHOLD && group.words.size >= MIN_MESSAGE_WORDS,
  );

  const harsh = new Set(
    input.corrections.filter((c) => Number.isFinite(c.cortisol) && c.cortisol >= HARSH_CORTISOL).map((c) => c.noteId),
  );

  const hits: TraumaHit[] = [];
  for (const note of input.notes) {
    if (note.isTrauma) continue;
    const noteWords = words(note.text);
    // Repetition path: do not mark a superseded note; trauma belongs to the past.
    if (!note.superseded && noteWords.size > 0) {
      const overlap = repeated.some((group) => {
        // Project scope: a global note with any error, a project note only with its own project.
        if (note.project !== null && note.project !== group.project) return false;
        // Time: the error cannot precede the note.
        if (group.ts < note.createdAt) return false;
        let shared = 0;
        for (const word of group.words) if (noteWords.has(word)) shared++;
        return shared >= MIN_SHARED_WORDS && shared / group.words.size >= OVERLAP_THRESHOLD;
      });
      if (overlap) {
        hits.push({ noteId: note.id, reason: 'repeated error' });
        continue;
      }
    }
    if (harsh.has(note.id)) hits.push({ noteId: note.id, reason: 'harsh correction' });
  }
  return hits;
}

/** Writes the detected ones; returns the ids of the newly written ones. */
export function applyTraumaDetection(memory: MemoryStore, input: DetectionInput): string[] {
  const marked: string[] = [];
  for (const hit of detectTrauma(input)) {
    if (memory.markTrauma(hit.noteId, hit.reason)) marked.push(hit.noteId);
  }
  return marked;
}
