# KAREN Phase 3 — Neural Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make memory behave biologically — the link between concepts used together thickens, information that crashes the system is never forgotten, old and solid memories are recalled as intuition weights instead of text, and in a crisis the context tunnels down to focus on the error alone.

**Architecture:** Four independent mechanisms, all as projections over the existing append-only event log:
(1) **Hebbian** — `last_at` is added to the `memory_links` row; the weight is stored in the event **as computed** (replay is deterministic), it decays over time on the read path (half-life 30 days, floor 0.05), and linking again reinforces.
(2) **Trauma** — `memory_notes.is_trauma` column + `memory_score op:'trauma'` event; detection is deterministic (`server/memory/trauma.ts`), the model cannot write it, `decay()` skips it.
(3) **Intuition** — an `intuitions` table **derived** from notes (writes no events; since the notes are in the log it can be rebuilt); a text-free weight line in the prompt.
(4) **Cocktail party** — while cortisol ≥ 0.70, `trimCrisis` instead of `trimHistory`; the error summary goes into the system prompt, not the chat history.

**Tech Stack:** TypeScript ESM, better-sqlite3, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-karen-biological-brain-design.md` (§9, §15/9)

## Global Constraints

- No new dependencies. `package.json` dependencies do not change.
- The append-only event log and the hash chain are preserved; no event is deleted or modified.
- **Evidence rule (article 19) holds in every phase:** no new path can write a note without a citation. Trauma and intuition work on *existing* notes and produce no new notes.
- Every projection can be rebuilt from the event log; after `rebuild()` the result is identical.
- **The model cannot imprint trauma, nor change its own identity.** Trauma comes only from deterministic detection or an explicit user mark.
- Values are locked to `[0,1]`; `NaN` never leaks out; if the clock goes backwards there is no negative duration.
- Turkish UI strings; code identifiers in English, comments in Turkish.
- Tests use an injected clock, no real waiting.
- At the end of every phase: `npx tsc --noEmit` clean · `npm test` green · `npm run build` clean.

## Review Focus

Where the spec stays silent and real use breaks first:

1. **Link inflation** — if notes recalled together every turn get linked, a full graph forms in a few days and the "right lobe" brings everything. Co-activation must be limited to 2–4 notes, otherwise intuition turns into noise.
2. **Trauma inflation** — if every error becomes trauma the system stays permanently in alarm mode. The 3-repeat threshold and the identical error text condition must hold.
3. **Intuition leakage** — the intuition line must not carry text (spec §12: "not as text"); it must carry source identities.
4. **Crisis trim information loss** — history must come back once cortisol drops; the trim must not be permanent, only for that request.
5. **Rebuild** — deleting the `intuitions` table must regenerate it from the notes; the `memory_links` `last_at` migration must not blow up on old rows.
6. **Clock jump** — a trauma note fast-forwarded 10 years still must not go cold; link weight must not drop below the floor.
7. **Empty memory** — with no notes at all, intuition/trauma code must not divide by zero; it must return an empty list.

---

### Task 1: Link math (pure)

**Files:**
- Create: `server/memory/links.ts`
- Test: `test/links-math.test.ts`

**Interfaces:**
- Consumes: none (pure module).
- Produces:
  ```ts
  export const LINK_GAIN = 0.15;        // how much of the remaining gap each relink closes
  export const LINK_HALF_LIFE_DAYS = 30;
  export const LINK_FLOOR = 0.05;
  export const LINK_STRONG = 0.8;       // context preload threshold

  /** Hebbian: repeated co-use thickens the link, never exceeds 1. */
  export function reinforce(weight: number, gain?: number): number;

  /** An unused link thins over time; it never drops below the floor, never disappears. */
  export function decayedWeight(weight: number, lastAt: number, now: number): number;

  /** Strong enough for context preload. */
  export function isStrong(weight: number): boolean;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/links-math.test.ts
import { describe, it, expect } from 'vitest';
import { decayedWeight, isStrong, reinforce, LINK_FLOOR, LINK_STRONG } from '../server/memory/links.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();

describe('reinforce', () => {
  it('reinforces the link, does not exceed 1', () => {
    expect(reinforce(0.5)).toBeCloseTo(0.575, 5);
    expect(reinforce(0.9)).toBeCloseTo(0.915, 5);
    let w = 0.5;
    for (let i = 0; i < 100; i++) w = reinforce(w);
    expect(w).toBeLessThanOrEqual(1);
    expect(w).toBeGreaterThan(0.99);
  });

  it('increases monotonically', () => {
    let prev = 0.1;
    for (let i = 0; i < 10; i++) {
      const next = reinforce(prev);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  it('invalid input is safe', () => {
    expect(reinforce(Number.NaN)).toBeGreaterThanOrEqual(0);
    expect(reinforce(-5)).toBeGreaterThanOrEqual(0);
    expect(reinforce(5)).toBeLessThanOrEqual(1);
  });
});

describe('decayedWeight', () => {
  it('halves in one half-life', () => {
    expect(decayedWeight(0.9, NOW, NOW + 30 * DAY)).toBeCloseTo(0.45, 2);
  });

  it('never drops below the floor', () => {
    expect(decayedWeight(0.9, NOW, NOW + 3650 * DAY)).toBeCloseTo(0.05, 5);
    expect(decayedWeight(0.9, NOW, NOW + 3650 * DAY)).toBeGreaterThanOrEqual(0.05);
  });

  it('a fresh link does not change', () => {
    expect(decayedWeight(0.7, NOW, NOW)).toBeCloseTo(0.7, 5);
  });

  it('no negative duration when the clock goes backwards', () => {
    expect(decayedWeight(0.7, NOW, NOW - 10 * DAY)).toBeCloseTo(0.7, 5);
  });

  it('produces no NaN', () => {
    const v = decayedWeight(Number.NaN, NOW, NOW + DAY);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(LINK_FLOOR);
  });
});

describe('isStrong', () => {
  it('strong at and above the threshold', () => {
    expect(isStrong(LINK_STRONG)).toBe(true);
    expect(isStrong(0.95)).toBe(true);
    expect(isStrong(0.79)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/links-math.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Implement**

- `clamp01` local helper: `Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))`.
- `reinforce(w)` = `clamp01(w) + LINK_GAIN * (1 - clamp01(w))`.
- `decayedWeight(w, lastAt, now)`: `elapsed = Math.max(0, now - lastAt)`; for invalid numbers `elapsed = 0`; `value = clamp01(w) * Math.pow(0.5, elapsed / (LINK_HALF_LIFE_DAYS * 86_400_000))`; `Math.max(LINK_FLOOR, Math.min(1, value))`.
- `isStrong(w)` = `w >= LINK_STRONG`.

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/links-math.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/memory/links.ts test/links-math.test.ts
git commit -m "feat(memory): hebbian link math (reinforcement, decay, threshold)"
```

---

### Task 2: Link reinforcement and trauma in the memory store

**Files:**
- Modify: `server/memory/notes.ts` (`memory_links.last_at` migration, `link()` reinforcement, `is_trauma` column, `op:'trauma'`, `decay()` skip, `strength` floor)
- Test: `test/memory-hebbian.test.ts`, `test/memory-trauma.test.ts`

**Interfaces:**
- Consumes: `reinforce`, `decayedWeight` (Task 1).
- Produces (added/changed on MemoryStore):
  - `Note.isTrauma: boolean`
  - `link(a, b, weight?)` — **does not overwrite, reinforces**: the existing decayed weight is computed with `decayedWeight`, then `reinforce` is applied; for a new pair the start is `clamp01(weight ?? 0.5)`.
  - `linkWeight(a, b, now?)` → `{ weight: number; lastAt: number } | null` — the decayed weight on the read path.
  - `markTrauma(id, reason): boolean` — `memory_score` `op:'trauma'`, `{ reason }`; `false` if already trauma.
  - `traumaNotes(): Note[]`
  - `rebuild()` preserves the trauma flag (it comes from the event).

**Schema changes (migration, does not touch the append-only log):**
```sql
ALTER TABLE memory_notes ADD COLUMN is_trauma INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_links ADD COLUMN last_at INTEGER NOT NULL DEFAULT 0;
```
Old rows with `last_at = 0` are considered **fresh** (`lastAt <= 0` → treated as `now` inside `decayedWeight`), so the existing accumulation does not decay all at once after the migration.

- [ ] **Step 1: Write the failing tests**

```ts
// test/memory-hebbian.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore, strength } from '../server/memory/notes.js';
import { LINK_FLOOR } from '../server/memory/links.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const a = memory.add({ kind: 'semantic', text: 'c++ compiler', evidence: [1], base: 0.6 });
  const b = memory.add({ kind: 'semantic', text: 'ai model', evidence: [2], base: 0.6 });
  return { log, memory, a, b };
}

describe('hebbian link', () => {
  it('linking twice increases the weight', () => {
    const { memory, a, b } = setup();
    memory.link(a.id, b.id, 0.5);
    const first = memory.linkWeight(a.id, b.id)!.weight;
    memory.link(a.id, b.id);
    const second = memory.linkWeight(a.id, b.id)!.weight;
    expect(second).toBeGreaterThan(first);
  });

  it('reinforces in five repeats, does not exceed 1', () => {
    const { memory, a, b } = setup();
    for (let i = 0; i < 5; i++) memory.link(a.id, b.id);
    const w = memory.linkWeight(a.id, b.id)!.weight;
    expect(w).toBeGreaterThan(0.6);
    expect(w).toBeLessThanOrEqual(1);
  });

  it('the read path decays over time', () => {
    const { memory, a, b } = setup();
    memory.link(a.id, b.id, 0.9);
    const fresh = memory.linkWeight(a.id, b.id, NOW)!.weight;
    const old = memory.linkWeight(a.id, b.id, NOW + 60 * DAY)!.weight;
    expect(old).toBeLessThan(fresh);
    expect(old).toBeGreaterThanOrEqual(LINK_FLOOR);
  });

  it('decay never drops below the floor, the link is not deleted', () => {
    const { memory, a, b } = setup();
    memory.link(a.id, b.id, 0.9);
    const w = memory.linkWeight(a.id, b.id, NOW + 10 * 365 * DAY)!.weight;
    expect(w).toBeCloseTo(LINK_FLOOR, 5);
    expect(memory.linksOf(a.id)).toHaveLength(1);
  });

  it('rebuild preserves the weight', () => {
    const { memory, a, b } = setup();
    memory.link(a.id, b.id, 0.5);
    memory.link(a.id, b.id);
    const before = memory.linkWeight(a.id, b.id, NOW)!.weight;
    memory.rebuild();
    expect(memory.linkWeight(a.id, b.id, NOW)!.weight).toBeCloseTo(before, 6);
  });

  it('no self-link', () => {
    const { memory, a } = setup();
    memory.link(a.id, a.id);
    expect(memory.linksOf(a.id)).toHaveLength(0);
  });
});
```

```ts
// test/memory-trauma.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore, strength } from '../server/memory/notes.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();

describe('trauma', () => {
  it('marked and permanent', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'this library crashes the process', evidence: [1], base: 0.6 });
    expect(memory.get(note.id)!.isTrauma).toBe(false);
    expect(memory.markTrauma(note.id, 'repeated error')).toBe(true);
    expect(memory.get(note.id)!.isTrauma).toBe(true);
    expect(memory.markTrauma(note.id, 'repeat')).toBe(false);
    expect(memory.traumaNotes().map((n) => n.id)).toContain(note.id);
  });

  it('rebuild preserves trauma', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'never forget', evidence: [1], base: 0.6 });
    memory.markTrauma(note.id, 'user');
    memory.rebuild();
    expect(memory.get(note.id)!.isTrauma).toBe(true);
  });

  it('a trauma note does not go cold even after 10 years', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'permanent lesson', evidence: [1], base: 0.4 });
    memory.markTrauma(note.id, 'user');
    const result = memory.decay(NOW + 10 * 365 * DAY);
    expect(result.dormant).not.toContain(note.id);
    expect(memory.get(note.id)!.dormant).toBe(false);
  });

  it('trauma strength never falls below the threshold', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const note = memory.add({ kind: 'semantic', text: 'hard lesson', evidence: [1], base: 0.2 });
    memory.markTrauma(note.id, 'user');
    const kept = memory.get(note.id)!;
    expect(kept.storage).toBeGreaterThanOrEqual(10);
    expect(strength(kept, NOW + 10 * 365 * DAY)).toBeGreaterThan(0.3);
  });
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run test/memory-hebbian.test.ts test/memory-trauma.test.ts`
Expected: FAIL — `linkWeight`/`markTrauma`/`isTrauma` missing.

- [ ] **Step 3: Implement**

- `Note` type + `NoteRow` + `toNote` + `migrate()`: `is_trauma`.
- `memory_links` migration: `last_at INTEGER NOT NULL DEFAULT 0`.
- `applyLink(a, b, weight, lastAt)` — the two-way write is preserved (`INSERT ... ON CONFLICT(a,b) DO UPDATE SET weight = excluded.weight, last_at = excluded.last_at`).
- `link(a, b, weight?)`: read the existing row with `linkWeight`; `next = existing ? reinforce(existing.weight) : clamp01(weight ?? 0.5)`; event `{ a, b, weight: next, lastAt: now }`; `apply(event)` writes the same values (replay is deterministic).
- `linkWeight(a, b, now = Date.now())`: read the raw row; if `lastAt <= 0` treat it as `now`; `decayedWeight`.
- `linksOf(id, now = Date.now())`: returns the decayed weight (callers stay the same).
- `markTrauma`: `appendScore(id, 'trauma', { reason })`; inside `apply` `op === 'trauma'` → `UPDATE memory_notes SET is_trauma = 1, storage = MAX(storage, 10), dormant = 0 WHERE id = ?`.
- `decay()`: `if (note.isTrauma) continue;`.
- Add `'trauma'` to the `appendScore` op union.
- `traumaNotes()`: `list({ includeDormant: true }).filter((n) => n.isTrauma)`.

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/memory-hebbian.test.ts test/memory-trauma.test.ts test/memory.test.ts test/memory-fsrs.test.ts`
Expected: PASS

- [ ] **Step 5: All tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean + PASS

- [ ] **Step 6: Commit**

```bash
git add server/memory/notes.ts server/memory/links.ts test/memory-hebbian.test.ts test/memory-trauma.test.ts
git commit -m "feat(memory): hebbian reinforcement, link decay and trauma flag"
```

---

### Task 3: Co-recall and strong-link preload

**Files:**
- Modify: `server/memory/notes.ts` (`coRecall` method, strong-link seeds inside `recall`)
- Modify: `server/sessions.ts` (`coRecall` after `recordRecall`)
- Test: `test/memory-corecall.test.ts`

**Interfaces:**
- Consumes: `link`, `linksOf`, `isStrong` (Task 1–2).
- Produces:
  - `coRecall(ids: string[], now?): number` — links the pairs of notes recalled in the same turn; **only between 2–4 notes**, at most `MAX_CO_RECALL_PAIRS = 3` pairs; the returned number is how many links were created/reinforced.
  - `recall()` behaviour: even when the left lobe is empty, **strongly linked** neighbours become context candidates (single hop, no chain).

**Why the limit:** if all pairs were linked every turn, 10 notes would give 45 pairs and the graph would saturate within days; the "right lobe" would bring everything and intuition would turn into noise.

- [ ] **Step 1: Write the failing test**

```ts
// test/memory-corecall.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { LINK_STRONG } from '../server/memory/links.js';

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const notes = ['c++ compiler', 'ai model', 'hardware acceleration', 'pdf generation', 'speech recognition'].map((text, i) =>
    memory.add({ kind: 'semantic', text, evidence: [i + 1], base: 0.5 }),
  );
  return { log, memory, notes };
}

describe('coRecall', () => {
  it('links notes recalled in the same turn', () => {
    const { memory, notes } = setup();
    const count = memory.coRecall([notes[0]!.id, notes[1]!.id]);
    expect(count).toBe(1);
    expect(memory.linksOf(notes[0]!.id).map((l) => l.id)).toContain(notes[1]!.id);
  });

  it('limits the number of pairs (at most 3)', () => {
    const { memory, notes } = setup();
    const ids = notes.map((n) => n.id);
    const count = memory.coRecall(ids);
    expect(count).toBeLessThanOrEqual(3);
  });

  it('repeated co-recall reinforces the link', () => {
    const { memory, notes } = setup();
    memory.coRecall([notes[0]!.id, notes[1]!.id]);
    const first = memory.linkWeight(notes[0]!.id, notes[1]!.id)!.weight;
    memory.coRecall([notes[0]!.id, notes[1]!.id]);
    const second = memory.linkWeight(notes[0]!.id, notes[1]!.id)!.weight;
    expect(second).toBeGreaterThan(first);
  });

  it('a single note does nothing', () => {
    const { memory, notes } = setup();
    expect(memory.coRecall([notes[0]!.id])).toBe(0);
    expect(memory.linksOf(notes[0]!.id)).toHaveLength(0);
  });

  it('unknown ids are ignored', () => {
    const { memory, notes } = setup();
    expect(memory.coRecall([notes[0]!.id, 'nope'])).toBe(0);
  });
});

describe('strong-link preload', () => {
  it('a strongly linked note is recalled even without a word match', () => {
    const { memory, notes } = setup();
    // Push the link above the threshold.
    for (let i = 0; i < 20; i++) memory.link(notes[0]!.id, notes[1]!.id);
    expect(memory.linkWeight(notes[0]!.id, notes[1]!.id)!.weight).toBeGreaterThanOrEqual(LINK_STRONG);

    const hits = memory.recall('c++ compiler', { limit: 5, hops: 1 });
    expect(hits.map((h) => h.id)).toContain(notes[1]!.id);
  });

  it('a weak link does not preload', () => {
    const { memory, notes } = setup();
    memory.link(notes[0]!.id, notes[1]!.id, 0.1);
    const hits = memory.recall('pdf generation', { limit: 5, hops: 1 });
    expect(hits.map((h) => h.id)).not.toContain(notes[1]!.id);
  });
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run test/memory-corecall.test.ts`
Expected: FAIL — no `coRecall`; no strong-link preload.

- [ ] **Step 3: Implement**

`coRecall(ids, now)`: filter to existing, non-forgotten notes; if fewer than 2, `0`. Generate ordered pairs (`i<j`), take at most `MAX_CO_RECALL_PAIRS` pairs, call `link(a, b)` for each (which already reinforces), return the counter.

`recall()`: the existing right-lobe spread is preserved. In addition, neighbours where `isStrong(link.weight)` holds for the `leftOrder` seeds are added to `rightScore` with `Math.max(existing, link.weight)` — the existing loop already skips left-lobe members at `hop=0`; preload must not be affected by that skip, so strong neighbours are written into `rightScore` through a separate `strongNeighbours` set and enter `rightRank`.

`server/sessions.ts`: immediately after the `recordRecall` call:
```ts
if (this.deps.memory && recalled.notes.length > 1) {
  try { this.deps.memory.coRecall(recalled.notes.map((n) => n.id)); } catch { /* a memory error must not drop the turn */ }
}
```

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/memory-corecall.test.ts test/memory-search.test.ts test/session-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/memory/notes.ts server/sessions.ts test/memory-corecall.test.ts
git commit -m "feat(memory): co-recall links and strong-link preload"
```

---

### Task 4: Trauma detection and user mark

**Files:**
- Create: `server/memory/trauma.ts`
- Modify: `server/memory/sleep.ts` (`applyTraumaDetection` call)
- Modify: `server/memory/notes.ts` (`correct()` carries cortisol)
- Modify: `server/http/server.ts` (`POST /api/memory/:id/trauma` + cortisol on the `correct` route)
- Modify: `server/serve.ts` (route wiring)
- Test: `test/trauma-detect.test.ts`, `test/http-trauma.test.ts`

**Cortisol carriage decision.** The "hard correction" rule needs the cortisol at the moment of correction; `MemoryStore.correct()` does not receive it today. Solution: `correct(id, text?, opts?: { cortisol?: number })` — when given, `cortisol` is written into the `memory_score op:'correct'` payload (replay reads the same value). The HTTP `correct` route passes `opts.state?.current().cortisol`. That way detection reads deterministically from the log and the model writes nothing.

**Interfaces:**
- Consumes: `MemoryStore.markTrauma`, `traumaNotes`, `EventLog`.
- Produces:
  ```ts
  export type TraumaHit = { noteId: string; reason: 'repeated error' | 'hard correction' | 'user' };
  export const REPEAT_THRESHOLD = 3;

  /** Deterministic detection. Same input, same output; no model call. */
  export function detectTrauma(input: {
    notes: { id: string; text: string; corrected: boolean; isTrauma: boolean }[];
    errors: { message: string }[];
    corrections: { noteId: string; cortisol: number }[];
  }): TraumaHit[];

  /** Writes what was detected; returns the ids of the newly written ones. */
  export function applyTraumaDetection(memory: MemoryStore, input: Parameters<typeof detectTrauma>[0]): string[];
  ```

**Detection rules (deterministic, all of them):**
1. **Repeated error:** if the same `error.message` (lowercased, trimmed) occurs at least `REPEAT_THRESHOLD` times, an **existing** note sharing ≥ 60% of that message's words becomes trauma.
2. **Hard correction:** a note with `cortisol >= 0.6` in `corrections` becomes trauma.
3. **User mark:** the HTTP route calls `markTrauma(id, 'user')` directly; the detection function does not produce it.

- [ ] **Step 1: Write the failing tests**

```ts
// test/trauma-detect.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { applyTraumaDetection, detectTrauma, REPEAT_THRESHOLD } from '../server/memory/trauma.js';

const note = (id: string, text: string, over: Partial<{ corrected: boolean; isTrauma: boolean }> = {}) => ({
  id,
  text,
  corrected: over.corrected ?? false,
  isTrauma: over.isTrauma ?? false,
});

describe('detectTrauma', () => {
  it('an error repeated three times makes the related note trauma', () => {
    const errors = Array.from({ length: REPEAT_THRESHOLD }, () => ({
      message: 'electron ABI mismatch: better-sqlite3 must be rebuilt',
    }));
    const hits = detectTrauma({
      notes: [note('n1', 'better-sqlite3 electron ABI mismatch requires a rebuild')],
      errors,
      corrections: [],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ noteId: 'n1', reason: 'repeated error' });
  });

  it('two repeats are not enough', () => {
    const errors = Array.from({ length: REPEAT_THRESHOLD - 1 }, () => ({ message: 'the same error text here' }));
    expect(detectTrauma({ notes: [note('n1', 'the same error text here')], errors, corrections: [] })).toEqual([]);
  });

  it('an unrelated note does not become trauma', () => {
    const errors = Array.from({ length: 5 }, () => ({ message: 'electron ABI mismatch' }));
    const hits = detectTrauma({ notes: [note('n1', 'the user likes turkish')], errors, corrections: [] });
    expect(hits).toEqual([]);
  });

  it('a high-cortisol correction makes trauma', () => {
    const hits = detectTrauma({
      notes: [note('n1', 'wrong information')],
      errors: [],
      corrections: [{ noteId: 'n1', cortisol: 0.7 }],
    });
    expect(hits[0]).toEqual({ noteId: 'n1', reason: 'hard correction' });
  });

  it('a low-cortisol correction does not make trauma', () => {
    const hits = detectTrauma({ notes: [note('n1', 'x')], errors: [], corrections: [{ noteId: 'n1', cortisol: 0.2 }] });
    expect(hits).toEqual([]);
  });

  it('a note that is already trauma is not written again', () => {
    const errors = Array.from({ length: 3 }, () => ({ message: 'the same error text' }));
    const hits = detectTrauma({ notes: [note('n1', 'the same error text', { isTrauma: true })], errors, corrections: [] });
    expect(hits).toEqual([]);
  });

  it('empty input is safe', () => {
    expect(detectTrauma({ notes: [], errors: [], corrections: [] })).toEqual([]);
  });

  it('deterministic', () => {
    const input = {
      notes: [note('n1', 'the same error text here')],
      errors: Array.from({ length: 3 }, () => ({ message: 'the same error text here' })),
      corrections: [],
    };
    expect(detectTrauma(input)).toEqual(detectTrauma(input));
  });
});

describe('applyTraumaDetection', () => {
  it('writes what was detected and returns ids', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const n = memory.add({ kind: 'semantic', text: 'electron ABI mismatch rebuild', evidence: [1], base: 0.5 });
    const ids = applyTraumaDetection(memory, {
      notes: memory.list().map((x) => ({ id: x.id, text: x.text, corrected: x.corrected, isTrauma: x.isTrauma })),
      errors: Array.from({ length: 3 }, () => ({ message: 'electron ABI mismatch rebuild' })),
      corrections: [],
    });
    expect(ids).toContain(n.id);
    expect(memory.get(n.id)!.isTrauma).toBe(true);
  });

  it('a second call writes nothing new', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    memory.add({ kind: 'semantic', text: 'the same error text here', evidence: [1], base: 0.5 });
    const input = () => ({
      notes: memory.list().map((x) => ({ id: x.id, text: x.text, corrected: x.corrected, isTrauma: x.isTrauma })),
      errors: Array.from({ length: 3 }, () => ({ message: 'the same error text here' })),
      corrections: [],
    });
    expect(applyTraumaDetection(memory, input())).toHaveLength(1);
    expect(applyTraumaDetection(memory, input())).toHaveLength(0);
  });
});
```

```ts
// test/http-trauma.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKarenServer, type EventHub, type KarenServer } from '../server/http/server.js';
import { ApprovalBroker } from '../server/http/approvals.js';
import { RepoStore } from '../server/repos.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';

const TOKEN = 't';
const servers: KarenServer[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'karen-trauma-'));
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const note = memory.add({ kind: 'semantic', text: 'never to be forgotten', evidence: [1], base: 0.5 });
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
    model: 'm', log, approve: async () => true, onEvent: (e) => hub.send(e),
  });
  const server = createKarenServer({
    repos: new RepoStore(join(dir, 'repos.json')), sessions, approvals: new ApprovalBroker(),
    hub, token: TOKEN, rootDir: dir, memory,
  });
  servers.push(server);
  return { server, memory, note };
}

describe('POST /api/memory/:id/trauma', () => {
  it('requires the token', async () => {
    const { server, note } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/${note.id}/trauma`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('marks the note as trauma', async () => {
    const { server, memory, note } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/${note.id}/trauma?token=${TOKEN}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(memory.get(note.id)!.isTrauma).toBe(true);
  });

  it('404 for an unknown id', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/missing/trauma?token=${TOKEN}`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run test/trauma-detect.test.ts test/http-trauma.test.ts`
Expected: FAIL — no module/route.

- [ ] **Step 3: Implement**

`server/memory/trauma.ts`: normalisation (lowercase, punctuation turned into spaces); group the error messages; take the ones with `count >= REPEAT_THRESHOLD`; for each note, a hit if word overlap >= 0.6. Skip the ones with `isTrauma`. Corrections: `cortisol >= 0.6`. A single hit per note (the first reason wins).

`applyTraumaDetection`: call `memory.markTrauma`, collect the ids of the ones returning `true`.

`notes.ts`: `correct(id, text?, opts?: { cortisol?: number })` — if given, `appendScore(id, 'correct', { cortisol })`; the text branch (`supersede`) carries the same payload.

`sleep.ts`: **after** distillation and linking, **before** `decay`:
```ts
const notes = memory.list({ includeDormant: true }).map((n) => ({ id: n.id, text: n.text, corrected: n.corrected, isTrauma: n.isTrauma }));
const errors = log.read().filter((e) => e.kind === 'error').slice(-200).map((e) => ({ message: String(e.payload['message'] ?? '') }));
const corrections = log.read().filter((e) => e.kind === 'memory_score' && e.payload['op'] === 'correct').slice(-200)
  .map((e) => ({ noteId: String(e.payload['noteId'] ?? ''), cortisol: Number(e.payload['cortisol'] ?? 0) }));
const traumaMarked = applyTraumaDetection(memory, { notes, errors, corrections });

```


`http/server.ts`: `parts[1] === 'memory' && req.method === 'POST' && parts[3] === 'trauma'` -> `memory.markTrauma(parts[2], 'user')`; 200/404. The `correct` route passes `opts.state?.current().cortisol`.
Add `traumaMarked: string[]` to `SleepReport` (`[]` on every early return).

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/trauma-detect.test.ts test/http-trauma.test.ts test/sleep.test.ts test/http-memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/memory/trauma.ts server/memory/sleep.ts server/http/server.ts server/serve.ts test/trauma-detect.test.ts test/http-trauma.test.ts
git commit -m "feat(memory): deterministic trauma detection and user mark"
```

---

### Task 5: Intuition projection and prompt line

**Files:**
- Create: `server/memory/intuition.ts`
- Modify: `server/sessions.ts` (intuition lines in `systemPrompt`)
- Modify: `server/memory/sleep.ts` (regenerate during sleep)
- Test: `test/intuition.test.ts`

**Interfaces:**
- Consumes: `MemoryStore`, `Note`.
- Produces:
  ```ts
  export const INTUITION_MIN_AGE_DAYS = 90;
  export const INTUITION_MIN_STORAGE = 6;
  export const INTUITION_MIN_NOTES = 2;

  export type Intuition = {
    id: string;                 // derived from the concept set (deterministic)
    concepts: string[];
    caution: number;            // 0..1 — trauma proximity
    confidence: number;         // 0..1 — source note count
    sourceNotes: string[];
    createdAt: number;
  };

  export function buildIntuitions(memory: MemoryStore, now?: number): Intuition[];
  export function intuitionLine(intuitions: Intuition[], query: string, limit?: number): string;
  ```

**Rules:**
- Candidate note: `now - createdAt >= 90 days` **and** `storage >= 3` **and** not forgotten.
- Group by concepts; at least 2 notes sharing the same concept → one intuition.
- `confidence = min(1, 0.4 + 0.15 * noteCount)`; `caution = 0.8 if any of the source notes is trauma, otherwise 0.2`.
- `id = 'intuition:' + sha1(sorted concepts).slice(0,12)`.
- **Carries no text.** Prompt line: `- intuition: c++/ai (confidence 0.70, caution 0.80, 3 memories) [source: n1 n2 n3]`.
- `intuitionLine` returns the first `limit` (default 3) intuitions intersecting the query concepts; empty string if there is no intersection.
- Persistence is **not needed**: intuitions are regenerated from notes (writes no events). They are computed during sleep and kept in process memory; `sessions.ts` regenerates them every turn (note count is bounded, ~ms).

- [ ] **Step 1: Write the failing test**

```ts
// test/intuition.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { buildIntuitions, intuitionLine, INTUITION_MIN_AGE_DAYS, INTUITION_MIN_STORAGE } from '../server/memory/intuition.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  return { log, memory };
}

/** Makes the note old and solid. */
function oldStrong(memory: MemoryStore, text: string, concepts: string[], evidence = 1) {
  const note = memory.add({ kind: 'semantic', text, concepts, evidence: [evidence], base: 0.7 }, NOW - (INTUITION_MIN_AGE_DAYS + 10) * DAY);
  for (let i = 0; i < INTUITION_MIN_STORAGE; i++) memory.review(note.id, 'good');
  return memory.get(note.id)!;
}

describe('buildIntuitions', () => {
  it('builds intuition from old and solid notes', () => {
    const { memory } = setup();
    oldStrong(memory, 'bottleneck in the c++ ai architecture', ['c++', 'ai']);
    oldStrong(memory, 'ai c++ memory management', ['c++', 'ai'], 2);
    const list = buildIntuitions(memory, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]!.concepts.sort()).toEqual(['ai', 'c++']);
    expect(list[0]!.confidence).toBeGreaterThan(0.5);
  });

  it('a young note produces no intuition', () => {
    const { memory } = setup();
    const a = memory.add({ kind: 'semantic', text: 'new information a', concepts: ['x'], evidence: [1], base: 0.7 });
    const b = memory.add({ kind: 'semantic', text: 'new information b', concepts: ['x'], evidence: [2], base: 0.7 });
    memory.review(a.id); memory.review(b.id);
    expect(buildIntuitions(memory, NOW)).toEqual([]);
  });

  it('one note is not enough', () => {
    const { memory } = setup();
    oldStrong(memory, 'not enough on its own', ['single']);
    expect(buildIntuitions(memory, NOW)).toEqual([]);
  });

  it('trauma proximity raises the caution score', () => {
    const { memory } = setup();
    const a = oldStrong(memory, 'dangerous pattern one', ['risk']);
    oldStrong(memory, 'dangerous pattern two', ['risk'], 2);
    memory.markTrauma(a.id, 'repeated error');
    const list = buildIntuitions(memory, NOW);
    expect(list[0]!.caution).toBeCloseTo(0.8, 5);
  });

  it('deterministic id', () => {
    const { memory } = setup();
    oldStrong(memory, 'a one', ['k1']);
    oldStrong(memory, 'a two', ['k1'], 2);
    const first = buildIntuitions(memory, NOW)[0]!.id;
    const second = buildIntuitions(memory, NOW)[0]!.id;
    expect(first).toBe(second);
    expect(first.startsWith('intuition:')).toBe(true);
  });

  it('empty memory is safe', () => {
    expect(buildIntuitions(setup().memory, NOW)).toEqual([]);
  });
});

describe('intuitionLine', () => {
  it('writes the intuition intersecting the query without text', () => {
    const { memory } = setup();
    oldStrong(memory, 'c++ ai bottleneck', ['c++', 'ai']);
    oldStrong(memory, 'ai c++ memory', ['c++', 'ai'], 2);
    const list = buildIntuitions(memory, NOW);
    const line = intuitionLine(list, 'c++ performance');
    expect(line).toContain('intuition:');
    expect(line).toContain('confidence');
    expect(line).toContain('source');
    // Leaks no text: the source note text must not appear.
    expect(line).not.toContain('bottleneck');
  });

  it('empty when there is no intersection', () => {
    const { memory } = setup();
    oldStrong(memory, 'c++ ai', ['c++', 'ai']);
    oldStrong(memory, 'c++ ai two', ['c++', 'ai'], 2);
    expect(intuitionLine(buildIntuitions(memory, NOW), 'food recipe')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/intuition.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Implement**

`server/memory/intuition.ts`: the rules above. `node:crypto` for `sha1`. A small local normalisation similar to `fold` (concept matching is case-insensitive).

`server/sessions.ts` `systemPrompt`: after the world model:
```ts
const intuitions = this.deps.memory ? buildIntuitions(this.deps.memory) : [];
const line = intuitionLine(intuitions, query ?? '');
if (line !== '') parts.push('', 'The following intuition lines come from weights, they are not text; they carry source identities.', line);
```
Add `query: string` (the user message) to the `systemPrompt` signature — `runTurn` already owns `text`.

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/intuition.test.ts test/session-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/memory/intuition.ts server/sessions.ts test/intuition.test.ts
git commit -m "feat(memory): intuition projection and text-free prompt line"
```

**Implementation note:** `server/memory/sleep.ts` was deliberately left unchanged; intuition is not a persistent projection, `buildIntuitions` is derived from the notes on the fly every turn and there is no cache to refresh.

---

### Task 6: Cocktail party — crisis trim and error summary

**Files:**
- Modify: `server/engine/history.ts` (add `trimCrisis`)
- Modify: `server/engine/loop.ts` (`AgentOptions.crisis`, choose the right trim)
- Modify: `server/sessions.ts` (pass the crisis flag, add the error summary to the prompt)
- Test: `test/history-crisis.test.ts`

**Interfaces:**
- Consumes: `gatesOf(state).crisis` (Phase 1), `ChatMessage`.
- Produces:
  ```ts
  /** Crisis: the last 2 user turns and after; the error trace is kept, history is dropped. */
  export function trimCrisis(messages: ChatMessage[], maxChars?: number): ChatMessage[];
  ```
  - Find the last **2** `role: 'user'` messages (from the end); those two turns plus the assistant/tool messages after them are kept; anything older is dropped.
  - If there are fewer than 2 user turns the whole history is kept (nothing to trim).
  - System messages are always preserved.
  - If anything was dropped, one line of note: `[crisis mode: previous N messages removed from context]`.
  - `maxChars` still applies (default 200_000).
- `AgentOptions.crisis?: boolean` — when true, `trimCrisis` instead of `trimHistory`.
- `sessions.ts`: while in crisis, a short summary of the last 5 `error` events is added to the system prompt (`## Recent errors`), not to the chat history.

**Measurement target (spec §9.5):** for the same chat, comparing cortisol 0.8 with 0.2, the number of characters sent drops by **≥ 50%**.

- [ ] **Step 1: Write the failing test**

```ts
// test/history-crisis.test.ts
import { describe, it, expect } from 'vitest';
import { trimCrisis, trimHistory } from '../server/engine/history.js';
import type { ChatMessage } from '../server/engine/types.js';

function longChat(turns: number): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: 'YOU ARE KAREN' }];
  for (let i = 0; i < turns; i++) {
    out.push({ role: 'user', content: `question ${i} `.padEnd(300, 'x') });
    out.push({ role: 'assistant', content: `answer ${i} `.padEnd(300, 'y') });
    out.push({ role: 'tool', content: `tool ${i} `.padEnd(300, 'z'), toolCallId: `c${i}` });
  }
  return out;
}

const chars = (m: ChatMessage[]) => m.reduce((n, x) => n + x.content.length, 0);

describe('trimCrisis', () => {
  it('keeps the last two user turns and after', () => {
    const out = trimCrisis(longChat(10));
    const users = out.filter((m) => m.role === 'user');
    expect(users).toHaveLength(2);
    expect(users[0]!.content).toContain('question 8');
    expect(users[1]!.content).toContain('question 9');
  });

  it('preserves the system message', () => {
    expect(trimCrisis(longChat(10))[0]).toEqual({ role: 'system', content: 'YOU ARE KAREN' });
  });

  it('markedly shorter than the normal trim', () => {
    const chat = longChat(20);
    expect(chars(trimCrisis(chat))).toBeLessThan(chars(trimHistory(chat)) * 0.5);
  });

  it('drops nothing in a short chat', () => {
    const chat = longChat(1);
    const out = trimCrisis(chat);
    expect(out.filter((m) => m.role !== 'system')).toHaveLength(3);
  });

  it('keeps the whole history when there are fewer than two turns', () => {
    const chat: ChatMessage[] = [
      { role: 'system', content: 'S' },
      { role: 'user', content: 'single question' },
      { role: 'assistant', content: 'single answer' },
    ];
    expect(trimCrisis(chat)).toHaveLength(3);
  });

  it('adds a one-line note when something was dropped', () => {
    const out = trimCrisis(longChat(10));
    expect(out.some((m) => m.role === 'assistant' && m.content.includes('crisis mode'))).toBe(true);
  });

  it('leaves no orphan tool message at the start', () => {
    const out = trimCrisis(longChat(10));
    const firstNonSystem = out.find((m) => m.role !== 'system');
    expect(firstNonSystem?.role).not.toBe('tool');
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/history-crisis.test.ts`
Expected: FAIL — no `trimCrisis`.

- [ ] **Step 3: Implement**

Add `trimCrisis` to `history.ts`. Implementation: separate the system messages; collect the user indices from the end; find the 2nd user index; cut from that index to the end; drop leading `tool` messages; if the number dropped is ≥ 2 add the note; then apply the shared `applyBudget` (chars) — the same tail logic as `trimHistory`, in one place.

`loop.ts`: `...(opts.crisis ? { maxChars: undefined } : {})` is unnecessary — directly:
```ts
const history = opts.crisis ? trimCrisis(historyIn) : trimHistory(historyIn);
...
messages: [{ role: 'system', content: opts.system }, ...history],
```
Note: `trimHistory` currently runs inside the `provider.stream` call every turn; the trim choice must be made in the same place.

`sessions.ts`: `...(snapshotState && gatesOf(snapshotState).crisis ? { crisis: true } : {})` and while in crisis:
```ts
const errors = this.deps.log.read().filter((e) => e.kind === 'error').slice(-5);
if (errors.length > 0) parts.push('', '## Recent errors', ...errors.map((e) => `- ${String(e.payload['message'] ?? '').slice(0, 160)}`));
```

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/history-crisis.test.ts test/history.test.ts test/session-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/engine/history.ts server/engine/loop.ts server/sessions.ts test/history-crisis.test.ts
git commit -m "feat(engine): tunnel vision and error summary in crisis mode"
```

---

### Task 7: Interface and dashboard (trauma badge, intuition count)

**Files:**
- Modify: `app/src/components/Memory.tsx` (trauma badge + "forget" button)
- Modify: `app/src/components/CommandCenter.tsx` (trauma count in the dashboard memory panel)
- Modify: `server/dashboard.ts` (`memory.trauma`, `intuitions`)
- Modify: `app/src/command.css` (badge style)
- Test: `test/dashboard.test.ts` (addition to the existing file)

**Interfaces:**
- Produces: `DashboardData.memory.trauma: number`, `DashboardData.intuitions: number`.

- [ ] **Step 1: Write the failing test**

```ts
// inside test/dashboard.test.ts
it('trauma and intuition counts go into the dashboard', () => {
  const { log, memory, approvals } = setup();
  const note = memory.add({ kind: 'semantic', text: 'permanent lesson', evidence: [1], base: 0.5 });
  memory.markTrauma(note.id, 'user');
  const data = buildDashboard({
    sessions: [], memory, approvals, logEvents: log.read(), voice,
    intuitions: 2,
  });
  expect(data.memory.trauma).toBe(1);
  expect(data.intuitions).toBe(2);
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/dashboard.test.ts`
Expected: FAIL — fields missing.

- [ ] **Step 3: Implement**

`dashboard.ts`: `memory.trauma` = `notes.filter((n) => n.isTrauma).length`; `intuitions?: number` optional input, default 0. `serve.ts` passes `buildIntuitions(memory).length`.

`Memory.tsx`: on the note card, a `trauma` badge if `isTrauma`; the button calls `POST /api/memory/:id/trauma` and refreshes the list.

`CommandCenter.tsx`: a `trauma` row in the `.cc-mini` list.

- [ ] **Step 4: Tests + build**

Run: `npx vitest run test/dashboard.test.ts && npx tsc --noEmit && npm run app:build`
Expected: PASS + clean

- [ ] **Step 5: Commit**

```bash
git add app/src server/dashboard.ts server/serve.ts test/dashboard.test.ts
git commit -m "feat(ui): trauma badge and intuition counter"
```

---

### Task 8: Version 1.4.0 and end-to-end verification

**Files:**
- Modify: `package.json` (`1.4.0`), `package-lock.json`, `CHANGELOG.md`, `README.md`, `site/index.html`

- [ ] **Step 1: Version + docs**

`1.4.0`; Hebbian, trauma, intuition, cocktail party in the changelog. A short "How memory strengthens" section in the README. A "Concepts used together get linked" card and a trauma/intuition row on the site.

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit && npm test && npm run build`

- [ ] **Step 3: Live verification**

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;" + $env:Path
$d = Join-Path $env:TEMP "karen-v14"
Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
  -ArgumentList "node_modules/tsx/dist/cli.mjs","server/cli.ts","serve","--port","7467","--data",$d `
  -RedirectStandardOutput "$env:TEMP\v14.log" -RedirectStandardError "$env:TEMP\v14e.log" -WindowStyle Hidden
Start-Sleep -Seconds 10
$tok = [regex]::Match((Get-Content "$env:TEMP\v14.log" -Raw), 'token=([a-f0-9]+)').Groups[1].Value
$dash = Invoke-RestMethod "http://127.0.0.1:7467/api/dashboard?token=$tok"
"dashboard: trauma=$($dash.memory.trauma) intuitions=$($dash.intuitions) notes=$($dash.memory.notes)"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*--port*7467*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
```

Expected: `trauma=0 intuitions=0 notes=0` — no division by zero on an empty install.

- [ ] **Step 4: Commit**

First run `npm install --package-lock-only` (so the lockfile version is 1.4.0), then:

```bash
git add package.json package-lock.json CHANGELOG.md README.md site/index.html
git commit -m "chore: v1.4.0 - neural growth"
```

---

## Phase 3 acceptance summary

- [ ] When the same pair is relinked the weight increases and does not exceed 1
- [ ] An unused link thins over time, never drops below the floor (0.05), is never deleted
- [ ] Co-recall links at most 3 pairs (the graph does not saturate)
- [ ] A strong link (≥0.8) enters the context even without a word match; a weak link does not
- [ ] Trauma is detected deterministically; the model cannot imprint it; it does not go cold after 10 years
- [ ] Trauma is preserved on rebuild
- [ ] Intuition leaks no text, carries source identity, requires 90 days + storage ≥ 3
- [ ] Crisis trim drops the character count by ≥ 50%; the system message and the last 2 turns remain
- [ ] The crisis error summary goes into the system prompt, not the chat history
- [ ] The evidence rule is intact (existing tests green)
- [ ] No division by zero on empty memory; `tsc` + all tests + build clean
