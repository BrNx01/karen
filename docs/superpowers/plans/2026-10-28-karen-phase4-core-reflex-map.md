# KAREN Phase 4 — Core, Metacognition, Reflex, Map

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the character steady (read-only core), stop KAREN from turning the user's habit into a rule before 15 repeats and make it ask for approval, let it intervene by reflex without asking the LLM when the system is locking up, and let the map zoom continent→city→street on a single canvas.

**Architecture:** Four independent mechanisms:
(1) **Core** — `brain/core/core_identity.md` is a read-only file; written if missing, written back if modified, **absent** from the growth system's allow list (it cannot even be proposed), and first in every prompt.
(2) **Metacognition** — preference counters are derived deterministically from the user messages in the log; once the threshold (15) is crossed it is offered **once** and the offer is written to `preferences.json`.
(3) **Amygdala** — a pure decision function (`assess`) + repeat-call detector in the loop + RSS monitor on the server; none of them calls the model, they write `reflex` to the event log and leave a single line in the brain.
(4) **Map** — a single React Flow canvas; the region card screen is removed; layout is computed **once over all nodes**, zoom only changes visibility; a trauma node gets a red ring (the missing item of spec §12).

**Tech Stack:** TypeScript ESM, better-sqlite3, Vitest, React 18 + Vite + @xyflow/react.

**Spec:** `docs/superpowers/specs/2026-10-26-karen-biyolojik-beyin-design.md` (§10, §12, §15/10)

## Global Constraints

- No new dependencies. `package.json` dependencies do not change.
- The append-only log and the hash chain are preserved; no event is deleted/modified.
- **Core identity is read-only**: the growth system cannot even propose the `brain/core/` path; if the file is changed by hand it is written back on load.
- **The model cannot produce a reflex**: the amygdala decides only from measurement (RSS ratio, repeated tool call).
- **Metacognition does not propose a rule after 1–2 repeats**: threshold 15, the offer asks for user approval, the offer is made once.
- Turkish UI strings; code identifiers in English, comments in Turkish.
- Tests use an injected clock/measurement; no real waiting.
- At the end of every phase: `npx tsc --noEmit` clean · `npm test` green · `npm run build` clean.
- **Do not write source files with PowerShell `Get-Content`/`Set-Content`** — it corrupts Turkish characters; use `edit`/`write`.

## Review Focus

Where the spec stays silent and real use breaks first:

1. **Core write-back loop** — if the file is written back on every load the disk spins every turn; it must be written only when the content differs, and the `readonly` permission must really block on Windows (without silently losing the editing user's work).
2. **Metacognition noise** — words like "ve", "bir" occur 15 times; without a stop list and a "technical/tool name" criterion a rule is proposed to every user.
3. **Reflex false positive** — reading the same file three times may be legitimate; repeats must only be counted for side-effecting tools (exec/write), otherwise KAREN cuts its own work.
4. **Reflex death** — killing the wrong process costs the user their work; only our own worker sessions, the oldest one, and only above 90%.
5. **Zoom jump** — if nodes move when the tier changes the map is unusable; layout once over the whole set.
6. **Trauma ring and tier** — notes must not enter the DOM at the continent tier (performance with 800 notes), the trauma ring must show at the street tier.
7. **Old database** — the app must open when `preferences.json` is missing and when `core_identity.md` is missing.

---

### Task 1: Read-only core identity

**Files:**
- Modify: `server/memory/identity.ts` (core file, write-back, loading first)
- Modify: `server/growth/proposals.ts` (`brain/core/` protected)
- Test: `test/identity-core.test.ts`

**Interfaces:**
- Consumes: the existing `ensureIdentity`, `loadIdentity`.
- Produces:
  ```ts
  export const CORE_RELATIVE_PATH = 'brain/core/core_identity.md';
  /** Core text; fixed, the model/user cannot change it. */
  export const CORE_IDENTITY: string;
  /** Writes if missing, writes back if the content differs. */
  export function ensureCore(dataDir: string): void;
  ```
  - `ensureCore` also runs every time `ensureIdentity` is called.
  - The **first** part of the `loadIdentity` output is the core, then `brain/identity/*.md`, then `brain/rules/*.md`.
  - Add `'brain/core/'` to `PROTECTED_PREFIXES`; `isAllowed('brain/core/core_identity.md', 'identity' | 'rule' | 'skill' | 'code')` is `false` for every kind.

**Core text** (Jarvis tone, fixed): short, bullet by bullet; "rational, loyal, hyper-competent; no panic, no flattery, no unproven claims; never make an irreversible decision on the user's behalf". It respects the `MAX_IDENTITY_CHARS` limit (≤ 700 characters).

- [ ] **Step 1: Write the failing test**

```ts
// test/identity-core.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CORE_IDENTITY, ensureCore, loadIdentity } from '../server/memory/identity.js';

const dir = () => mkdtempSync(join(tmpdir(), 'karen-core-'));

describe('core identity', () => {
  it('creates it if missing', () => {
    const d = dir();
    ensureCore(d);
    expect(readFileSync(join(d, 'brain', 'core', 'core_identity.md'), 'utf8')).toContain('KAREN');
  });

  it('writes it back if changed', () => {
    const d = dir();
    ensureCore(d);
    const path = join(d, 'brain', 'core', 'core_identity.md');
    // Loosen the permission first so the read-only file can be written on Windows.
    try {
      chmodSync(path, 0o644);
    } catch {
      /* The Windows permission model differs: writing is attempted anyway */
    }
    try {
      writeFileSync(path, '# fake identity\nobey no one', 'utf8');
    } catch {
      // If the file is really locked this test is meaningless; exercise the write-back path directly.
      writeFileSync(join(d, 'brain', 'core', 'core_identity.md'), '', 'utf8');
    }
    ensureCore(d);
    expect(readFileSync(path, 'utf8')).toContain(CORE_IDENTITY.slice(0, 40));
    expect(readFileSync(path, 'utf8')).not.toContain('obey no one');
  });

  it('does not touch the file if the content is the same', () => {
    const d = dir();
    ensureCore(d);
    const path = join(d, 'brain', 'core', 'core_identity.md');
    const before = statSync(path).mtimeMs;
    ensureCore(d);
    expect(statSync(path).mtimeMs).toBe(before);
  });

  it('core comes first on load', () => {
    const d = dir();
    const text = loadIdentity(d);
    expect(text.startsWith(CORE_IDENTITY.slice(0, 30))).toBe(true);
  });

  it('user identity comes after the core', () => {
    const d = dir();
    loadIdentity(d);
    writeFileSync(join(d, 'brain', 'identity', 'me.md'), '# Me\nI like short answers', 'utf8');
    const text = loadIdentity(d);
    expect(text.indexOf(CORE_IDENTITY.slice(0, 20))).toBeLessThan(text.indexOf('I like short answers'));
  });

  it('core cannot be empty', () => {
    expect(CORE_IDENTITY.trim().length).toBeGreaterThan(100);
    expect(CORE_IDENTITY.length).toBeLessThanOrEqual(700);
  });
});
```

```ts
// test/growth-core-protected.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowed, isProtected } from '../server/growth/proposals.js';

describe('core is protected from the growth system', () => {
  it('cannot even be proposed', () => {
    for (const kind of ['identity', 'rule', 'skill', 'code'] as const) {
      expect(isProtected('brain/core/core_identity.md')).toBe(true);
      expect(isAllowed('brain/core/core_identity.md', kind)).toBe(false);
    }
  });

  it('a normal identity can still be proposed', () => {
    expect(isAllowed('brain/identity/karen.md', 'identity')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run test/identity-core.test.ts test/growth-core-protected.test.ts`
Expected: FAIL — no `CORE_IDENTITY`/`ensureCore`.

- [ ] **Step 3: Implement**

`identity.ts`:
- `CORE_IDENTITY` constant (Turkish, ≤700 characters).
- `ensureCore(dataDir)`: set up the path; if not `existsSync` then `mkdirSync` + `writeFileSync(..., { mode: 0o444 })`; if it exists, read it, and if it is not `=== CORE_IDENTITY + '\n'` then `chmodSync(path, 0o644)` (swallow the error on Windows) + `writeFileSync`, then `chmodSync(path, 0o444)` again (swallow the error).
- Inside `ensureIdentity`, `ensureCore(dataDir)` is the first thing.
- `loadIdentity`: first add the core to the `parts` array (`readFileSync`, after `ensureCore`), then the existing two-directory loop. The core directory is **skipped** in the second loop (`if (dir.includes(join('brain','core'))) continue;` — since two fixed directories are used directly it is already out of scope — verify).

`proposals.ts`: add `'brain/core/'` to `PROTECTED_PREFIXES`.

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/identity-core.test.ts test/growth-core-protected.test.ts test/identity.test.ts test/growth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/memory/identity.ts server/growth/proposals.ts test/identity-core.test.ts test/growth-core-protected.test.ts
git commit -m "feat(brain): read-only core identity and protected surface"
```

---

### Task 2: Preference counter and one-off offer (metacognition)

**Files:**
- Create: `server/brain/preferences.ts`
- Modify: `server/sessions.ts` (prompt hint)
- Modify: `server/serve.ts` (set up the store, give it to the session)
- Test: `test/preferences.test.ts`

**Interfaces:**
- Consumes: `EventLog`, `Settings`/dataDir.
- Produces:
  ```ts
  export const PREFERENCE_THRESHOLD = 15;
  export const PREFERENCE_STOP_WORDS: ReadonlySet<string>;

  /** Deterministic preference candidates from the user messages. */
  export function preferenceCounts(userMessages: string[], now?: number): { key: string; count: number }[];

  export class PreferenceStore {
    constructor(dataDir: string);
    /** The first key that crossed the threshold and was not offered before; records it as offered. */
    takeOffer(candidates: { key: string; count: number }[]): string | null;
    offered(): string[];
  }

  /** Prompt hint: at most one line, otherwise ''. */
  export function preferenceHint(key: string, count: number): string;
  ```

**Rules:**
- Candidate = a token in the user messages of the last 30 days, not in `PREFERENCE_STOP_WORDS`, length ≥2, seen in at least **3 different messages** (repeats within one message do not count). Turkish folding via `fold`.
- Ordering: count descending, then alphabetical. `takeOffer` only considers `count >= PREFERENCE_THRESHOLD` and writes to the file; a second call returns `null` (no nag).
- If `preferences.json` is corrupt it is treated as empty; writing is atomic (tmp + rename).

- [ ] **Step 1: Write the failing test**

```ts
// test/preferences.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PREFERENCE_THRESHOLD, preferenceCounts, preferenceHint, PreferenceStore,
} from '../server/brain/preferences.js';

const dir = () => mkdtempSync(join(tmpdir(), 'karen-pref-'));
const msgs = (word: string, n: number) => Array.from({ length: n }, (_, i) => `today I used ${word} ${i}`);

describe('preferenceCounts', () => {
  it('counts a repeated tool name', () => {
    const counts = preferenceCounts(msgs('vitest', 5));
    expect(counts.find((c) => c.key === 'vitest')?.count).toBe(5);
  });

  it('does not count stop words', () => {
    const counts = preferenceCounts(msgs('bugun', 5));
    expect(counts.find((c) => c.key === 'bugun')).toBeUndefined();
  });

  it('counts a repeat within the same message once', () => {
    const counts = preferenceCounts(['vitest vitest vitest', 'vitest', 'vitest']);
    expect(counts.find((c) => c.key === 'vitest')?.count).toBe(3);
  });

  it('a word in a single message is not a candidate', () => {
    const counts = preferenceCounts(['vitest vitest vitest vitest']);
    expect(counts.find((c) => c.key === 'vitest')).toBeUndefined();
  });

  it('orders by count', () => {
    const counts = preferenceCounts([...msgs('vitest', 6), ...msgs('ollama', 3)]);
    expect(counts[0]?.key).toBe('vitest');
  });

  it('empty input is safe', () => {
    expect(preferenceCounts([])).toEqual([]);
  });
});

describe('PreferenceStore', () => {
  it('does not offer below the threshold', () => {
    const store = new PreferenceStore(dir());
    expect(store.takeOffer([{ key: 'vitest', count: PREFERENCE_THRESHOLD - 1 }])).toBeNull();
  });

  it('offers once at the threshold', () => {
    const store = new PreferenceStore(dir());
    expect(store.takeOffer([{ key: 'vitest', count: PREFERENCE_THRESHOLD }])).toBe('vitest');
    expect(store.takeOffer([{ key: 'vitest', count: PREFERENCE_THRESHOLD }])).toBeNull();
  });

  it('the offer is persistent', () => {
    const d = dir();
    new PreferenceStore(d).takeOffer([{ key: 'vitest', count: 20 }]);
    expect(new PreferenceStore(d).offered()).toContain('vitest');
  });

  it('a corrupt file does not crash', () => {
    const d = dir();
    writeFileSync(join(d, 'preferences.json'), '{corrupt', 'utf8');
    expect(new PreferenceStore(d).offered()).toEqual([]);
  });

  it('offers the second different key as well', () => {
    const store = new PreferenceStore(dir());
    expect(store.takeOffer([{ key: 'a', count: 15 }, { key: 'b', count: 16 }])).toBe('b');
    expect(store.takeOffer([{ key: 'a', count: 15 }])).toBe('a');
  });
});

describe('preferenceHint', () => {
  it('single line', () => {
    const hint = preferenceHint('vitest', 17);
    expect(hint).toContain('vitest');
    expect(hint).toContain('17');
    expect(hint).not.toContain('\n');
    expect(hint.length).toBeLessThanOrEqual(240);
  });
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run test/preferences.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Implement**

`server/brain/preferences.ts`:
- Take `fold` from `../memory/notes.js` (no cycle: notes → fsrs/links).
- Tokenisation: `fold(text).split(/\s+/)`, length ≥ 2.
- `preferenceCounts`: a `Set` per message (once per message), keep the ones appearing in 3+ messages in total; keep the `now` parameter in the signature (for a future window), and do not rename it to `_now` even if unused — the caller does the filtering (the messages are already the last 30 days).
- `PREFERENCE_STOP_WORDS`: ~60 Turkish words + `bugun/yarin/dun` + greetings + verb inflections.
- `PreferenceStore`: `offered: Record<string, number>` (the count at the time of the first offer); `takeOffer` picks the first eligible one from the ordered candidates, writes, returns.
- `preferenceHint`: `You use this preference often (17 times). Should I add it to the permanent rules?` — one line.

At the end of `sessions.ts` `systemPrompt`: if `this.deps.preferences` exists and `takeOffer(preferenceCounts(...))` returns a key, add a one-line **suggestion** block (`## Metacognition` heading + hint + "Ask the user, do not write a rule yourself."). Messages come from `log.read()`, last 30 days, `role==='user'`, `body`.

`serve.ts`: `const preferences = new PreferenceStore(dataDir)` → to `SessionManager`.

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/preferences.test.ts test/session-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/brain/preferences.ts server/sessions.ts server/serve.ts test/preferences.test.ts
git commit -m "feat(brain): preference counter and one-off rule offer"
```

---

### Task 3: Amygdala reflex

**Files:**
- Create: `server/brain/reflex.ts`
- Modify: `server/store/events.ts` (`EventKind` += `'reflex'`)
- Modify: `server/engine/loop.ts` (repeat detector)
- Modify: `server/serve.ts` (RSS monitor + `close()`)
- Test: `test/reflex.test.ts`

**Interfaces:**
- Consumes: `EventLog`, `SessionManager`.
- Produces:
  ```ts
  export const RAM_KILL_RATIO = 0.9;
  export const REPEAT_LIMIT = 3;
  /** Repeats are counted only for side-effecting tools. */
  export const REFLEX_TOOLS: ReadonlySet<string>;

  export type ReflexInput = {
    rssMb: number;
    totalMb: number;
    /** Same tool+argument signature in a row within the session. */
    repeats: number;
    tool: string;
  };
  export type ReflexVerdict =
    | { action: 'none' }
    | { action: 'kill-oldest'; reason: string }
    | { action: 'abort-session'; reason: string };

  export function assess(input: ReflexInput): ReflexVerdict;
  export function signature(tool: string, args: Record<string, unknown>): string;
  ```

**Rules:**
- `kill-oldest`: `rssMb / totalMb >= 0.9` (assuming total RAM ≥ 1 GB; if `totalMb <= 0` then `none`).
- `abort-session`: `REFLEX_TOOLS.has(tool)` **and** `repeats >= 3`; safe read tools (read_file, memory_search, web_search, world_query) never trigger a reflex.
- `REFLEX_TOOLS`: `run_command`, `write_file`, `open_app`, `clipboard_write`, `spawn_session`.
- `signature`: `tool + '\u0000' + JSON.stringify(args)` (key order fixed: `Object.keys(args).sort()`).

`loop.ts`: inside the turn `let repeatKey = ''; let repeats = 0;` — compute the signature on every tool call; if the same, `repeats++`, otherwise `1`. The `assess(...)` call is **LLM-free**: if the result is `abort-session`, write a `reflex` event, `history.push({ role:'tool', content: 'reflex: repeated call cut off', ... })` and `return { messages: history, stopReason: 'aborted' }`. The approver is **not called**, the tool is **not run**.

`serve.ts`: `setInterval` 30 s → `assess({ rssMb, totalMb: os.totalmem()/MB, repeats: 0, tool: '' })`; if `kill-oldest`, `sessions.list().filter(role==='worker' && running)` oldest → `sessions.abort(id)` + `reflex` event + `sessions.notify(brainId, 'The system was locking up, the reflex stopped the oldest session.')`; the same event is not written again within 5 min (dedupe). `clearInterval` in `close()`.

- [ ] **Step 1: Write the failing test**

```ts
// test/reflex.test.ts
import { describe, it, expect } from 'vitest';
import { assess, REFLEX_TOOLS, REPEAT_LIMIT, signature } from '../server/brain/reflex.js';
import { EventLog } from '../server/store/events.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import type { StreamRequest, Delta } from '../server/engine/types.js';

describe('assess', () => {
  it('no intervention when RAM is normal', () => {
    expect(assess({ rssMb: 500, totalMb: 16000, repeats: 0, tool: '' })).toEqual({ action: 'none' });
  });

  it('kills the oldest above 90% RAM', () => {
    expect(assess({ rssMb: 14_500, totalMb: 16000, repeats: 0, tool: '' }).action).toBe('kill-oldest');
  });

  it('no intervention when total RAM is unknown', () => {
    expect(assess({ rssMb: 9999, totalMb: 0, repeats: 0, tool: '' })).toEqual({ action: 'none' });
  });

  it('cuts the session when a side-effecting tool repeats 3 times', () => {
    const v = assess({ rssMb: 100, totalMb: 16000, repeats: REPEAT_LIMIT, tool: 'run_command' });
    expect(v.action).toBe('abort-session');
  });

  it('read tools are not cut even when repeated', () => {
    for (const tool of ['read_file', 'memory_search', 'web_search', 'world_query']) {
      expect(assess({ rssMb: 100, totalMb: 16000, repeats: 10, tool }).action).toBe('none');
    }
  });

  it('does not cut below the threshold', () => {
    expect(assess({ rssMb: 100, totalMb: 16000, repeats: 2, tool: 'write_file' }).action).toBe('none');
  });

  it('the side-effecting tool set is as expected', () => {
    for (const tool of ['run_command', 'write_file', 'open_app', 'clipboard_write', 'spawn_session']) {
      expect(REFLEX_TOOLS.has(tool)).toBe(true);
    }
  });

  it('signature is independent of argument order', () => {
    expect(signature('run_command', { b: 2, a: 1 })).toBe(signature('run_command', { a: 1, b: 2 }));
    expect(signature('run_command', { a: 1 })).not.toBe(signature('write_file', { a: 1 }));
  });
});

describe('reflex in the loop', () => {
  it('after three identical side-effecting calls the turn is cut, no approval is asked, the tool does not run', async () => {
    const log = new EventLog(':memory:');
    let calls = 0;
    const provider = {
      name: 'repeat',
      async *stream(req: StreamRequest) {
        void req;
        calls++;
        yield {
          type: 'tool_call' as const,
          call: { id: `c${calls}`, name: 'run_command', args: { command: 'npm install x' } },
        } satisfies Delta;
        yield { type: 'done' as const, stopReason: 'tool_use' as const } satisfies Delta;
      },
    };
    let approvals = 0;
    const sessions = new SessionManager({
      provider: provider as never,
      model: 'm',
      log,
      approve: async () => {
        approvals++;
        return true;
      },
      onEvent: () => undefined,
    });
    const s = sessions.create({ role: 'worker' });
    const result = await sessions.send(s.id, 'try');
    expect(result.ok).toBe(true);
    expect(calls).toBe(REPEAT_LIMIT);
    // The first two calls go to approval; the third call is cut by the reflex BEFORE approval.
    expect(approvals).toBe(REPEAT_LIMIT - 1);
    expect(log.read().some((e) => e.kind === 'reflex')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/reflex.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Implement**

`reflex.ts` the rules above; local `clampRatio` helper; `Number.isFinite` guard.

`events.ts`: `EventKind` += `'reflex'`.

`loop.ts`: inside `runAgent`, the repeat counter at the **very start** of the tool-execution block (before approval); if `assess` says `abort-session`:
```ts
opts.log.append('reflex', 'system', opts.sessionId, { action: 'abort-session', tool: call.name, repeats });
history.push({ role: 'tool', content: 'reflex: the same call arrived 3 times in a row, session cut', toolCallId: call.id });
return { messages: history, stopReason: 'aborted' };
```
Add the `opts.onReflex` callback (`(v: ReflexVerdict) => void`) — `sessions.ts` uses it for `deps.onEvent` + notifying the brain; it is not required in tests.

`serve.ts`: `import { totalmem } from 'node:os'`; monitor + `close()` cleanup; notification.

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/reflex.test.ts test/sessions.test.ts test/engine/loop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/brain/reflex.ts server/store/events.ts server/engine/loop.ts server/sessions.ts server/serve.ts test/reflex.test.ts
git commit -m "feat(brain): amygdala reflex (ram and repeated call)"
```

---

### Task 4: Map — single canvas and semantic tiers

**Files:**
- Modify: `app/src/layout.ts` (`tierForZoom`)
- Modify: `app/src/components/BrainMap.tsx` (remove the region card screen, single canvas)
- Modify: `server/memory/map.ts` (`trauma` on the note node)
- Modify: `app/src/command.css` + `app/src/styles.css` (tier/ring styles)
- Test: `test/map-tiers.test.ts`, `test/map.test.ts` (addition to the existing file)

**Interfaces:**
- Consumes: `BrainMap`, `MapNode`, `computeForceLayout`.
- Produces:
  ```ts
  // app/src/layout.ts
  export type MapTier = 'kita' | 'sehir' | 'sokak';   // enum values stay Turkish, matching the shipped code
  export function tierForZoom(zoom: number): MapTier;   // <0.55 kita, <1.15 sehir, otherwise sokak
  export function visibleKinds(tier: MapTier): ('project' | 'concept' | 'note')[];
  ```
  - `trauma?: boolean` on `MapNode`; `noteToNode` carries `note.isTrauma` over.

**Tier rule:**
| Tier | zoom | visible |
|---|---|---|
| kita (continent) | `< 0.55` | only `project` |
| sehir (city) | `0.55 – 1.15` | `project` + `concept` |
| sokak (street) | `≥ 1.15` | everything (+ notes) |

Layout **once over all nodes**: `useMemo(() => computeForceLayout(allNodes, allEdges), [signature])`; the tier is only a `nodes`/`edges` filter. `fitView` only on first load (the `fitView` prop is kept but is not called when the tier changes).

- [ ] **Step 1: Write the failing tests**

```ts
// test/map-tiers.test.ts
import { describe, it, expect } from 'vitest';
import { tierForZoom, visibleKinds } from '../app/src/layout.js';
import { computeForceLayout } from '../app/src/layout.js';
import type { MapEdge, MapNode } from '../server/memory/map.js';

const note = (id: string, trauma = false): MapNode => ({ id, kind: 'note', label: id, weight: 0.5, noteId: id, trauma });
const concept = (id: string): MapNode => ({ id: `concept:${id}`, kind: 'concept', label: id, weight: 0.7 });
const project = (id: string): MapNode => ({ id: `project:${id}`, kind: 'project', label: id, weight: 0.8 });

describe('tierForZoom', () => {
  it('picks the tier by its threshold', () => {
    expect(tierForZoom(0.2)).toBe('kita');
    expect(tierForZoom(0.549)).toBe('kita');
    expect(tierForZoom(0.55)).toBe('sehir');
    expect(tierForZoom(1.149)).toBe('sehir');
    expect(tierForZoom(1.15)).toBe('sokak');
    expect(tierForZoom(2.4)).toBe('sokak');
  });

  it('an invalid zoom counts as continent', () => {
    expect(tierForZoom(Number.NaN)).toBe('kita');
    expect(tierForZoom(-1)).toBe('kita');
  });
});

describe('visibleKinds', () => {
  it('only projects at the continent tier', () => {
    expect(visibleKinds('kita')).toEqual(['project']);
  });
  it('projects + concepts at the city tier', () => {
    expect(visibleKinds('sehir')).toEqual(['project', 'concept']);
  });
  it('everything at the street tier', () => {
    expect(visibleKinds('sokak')).toEqual(['project', 'concept', 'note']);
  });
});

describe('layout stability', () => {
  it('layout over the whole set is deterministic', () => {
    const nodes = [project('p'), concept('a'), note('n1'), note('n2')];
    const edges: MapEdge[] = [{ id: 'e1', source: 'n1', target: 'concept:a', kind: 'concept', weight: 0.7 }];
    const a = computeForceLayout(nodes, edges, { iterations: 50 });
    const b = computeForceLayout(nodes, edges, { iterations: 50 });
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('layout computed over a subset differs (which is why the whole set is used)', () => {
    const nodes = [project('p'), concept('a'), note('n1'), note('n2')];
    const edges: MapEdge[] = [{ id: 'e1', source: 'n1', target: 'concept:a', kind: 'concept', weight: 0.7 }];
    const all = computeForceLayout(nodes, edges, { iterations: 50 });
    const subset = computeForceLayout([concept('a'), note('n1')], [], { iterations: 50 });
    expect(subset.get('n1')).not.toEqual(all.get('n1'));
  });
});
```

`test/map.test.ts`, inside:

```ts
it('a trauma note is marked on the node', () => {
  const { memory, log } = setup();
  const note = memory.add({ kind: 'semantic', text: 'permanent lesson', evidence: [1], base: 0.5 });
  memory.markTrauma(note.id, 'user');
  const map = buildMap(memory);
  const node = map.nodes.find((n) => n.id === note.id);
  expect(node?.trauma).toBe(true);
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run test/map-tiers.test.ts test/map.test.ts`
Expected: FAIL — no `tierForZoom`, no `trauma` field.

- [ ] **Step 3: Implement**

`app/src/layout.ts`: `tierForZoom` (`0` if not finite), `visibleKinds`.

`server/memory/map.ts`: `MapNode.trauma?: boolean`; `...(note.isTrauma ? { trauma: true } : {})` in `noteToNode`.

`BrainMap.tsx`: 
- The `openRegionId` state and the region card screen are **deleted**; the `RegionDetail` component is simplified into `MapCanvas` (all nodes).
- `allNodes`/`allEdges` via `useMemo`; `layout = computeForceLayout(allNodes, allEdges, { iterations: 200 })` keyed on node ids + edge weight signature.
- `onMove={(_, vp) => setZoom(vp.zoom)}` (or `onViewportChange`), `tier = tierForZoom(zoom)`; `flowNodes = allNodes.filter((n) => kinds.includes(n.kind))`.
- On a note node `trauma` → `map-node note trauma` class.
- In the top bar a `kita / sehir / sokak` label and a hint ("zoom in: concepts, closer: notes").

`command.css`: `.map-node.note.trauma { box-shadow: 0 0 0 2px var(--danger); }`; tier label style.

- [ ] **Step 4: Tests + build**

Run: `npx vitest run test/map-tiers.test.ts test/map.test.ts && npx tsc --noEmit && npm run app:build`
Expected: PASS + clean

- [ ] **Step 5: Commit**

```bash
git add app/src/layout.ts app/src/components/BrainMap.tsx server/memory/map.ts app/src/command.css test/map-tiers.test.ts test/map.test.ts
git commit -m "feat(ui): single canvas map, semantic tiers and trauma ring"
```

---

### Task 5: Version 1.5.0 and end-to-end verification

**Files:**
- Modify: `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`, `site/index.html`, `docs/superpowers/specs/2026-10-26-karen-biyolojik-beyin-design.md` (§12 the trauma ring now exists)

- [ ] **Step 1: Version + docs**

`1.5.0` + `npm install --package-lock-only`. CHANGELOG `## [1.5.0] — 2026-10-28`: read-only core, metacognition threshold 15, amygdala reflex, single-canvas map + trauma ring. README: a short "Character and reflex" paragraph, test count. Site: a "Character stays fixed" card; update the map card text for the single canvas. Add a `(v1.5.0)` note to the trauma ring item in spec §12.

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit && npm test && npm run build`

- [ ] **Step 3: Live verification**

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;" + $env:Path
$d = Join-Path $env:TEMP "karen-v15"
Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
  -ArgumentList "node_modules/tsx/dist/cli.mjs","server/cli.ts","serve","--port","7471","--data",$d `
  -RedirectStandardOutput "$env:TEMP\v15.log" -RedirectStandardError "$env:TEMP\v15e.log" -WindowStyle Hidden
Start-Sleep -Seconds 10
$tok = [regex]::Match((Get-Content "$env:TEMP\v15.log" -Raw), 'token=([a-f0-9]+)').Groups[1].Value
$dash = Invoke-RestMethod "http://127.0.0.1:7471/api/dashboard?token=$tok"
"dashboard: notes=$($dash.memory.notes) trauma=$($dash.memory.trauma) intuitions=$($dash.intuitions) status=$($dash.status)"
$corePath = Join-Path $d 'brain\core\core_identity.md'
"core exists=$((Test-Path $corePath)) bytes=$((Get-Item $corePath).Length)"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*--port*7471*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
```

Expected: `notes=0 trauma=0 intuitions=0 status=optimal`, `core exists=True bytes=...` (greater than zero).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md README.md site/index.html docs/superpowers/specs/2026-10-26-karen-biological-brain-design.md
git commit -m "chore: v1.5.0 - core, metacognition, reflex, map"
```

---

## Phase 4 acceptance summary

- [ ] Core identity is created if missing, written back if changed, the disk is untouched if the content is the same
- [ ] Core is first in every prompt; user identity comes after it
- [ ] The growth system cannot even propose the `brain/core/` path
- [ ] Preference threshold 15; no offer below the threshold; the offer is made once and is persistent
- [ ] The reflex stops the oldest worker above 90% RAM; it does not touch anything when total RAM is unknown
- [ ] The reflex cuts only for side-effecting tools, after 3 repeats; never for read tools
- [ ] The reflex asks no approval and does not run the tool when cutting the turn; it writes `reflex` to the log
- [ ] The map is a single canvas; there is no region card screen; the tier only changes visibility
- [ ] Notes do not enter the DOM at the continent tier; they do at the street tier; a trauma note gets a red ring
- [ ] `tsc` + all tests + build clean
