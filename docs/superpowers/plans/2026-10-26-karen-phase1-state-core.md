# KAREN Phase 1 — State Core (Endocrine System) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `state_vector` (cortisol, dopamine, serotonin, fatigue, circadian) that is carried on every LLM call and can be rebuilt from events; make this vector actually change the system prompt and the temperature.

**Architecture:** State is computed with **pure functions** (`server/brain/state.ts`: decay, signal application, gates, prompt block). Persistence is a SQLite projection rebuilt from the existing append-only event log (`server/brain/store.ts`): dropping the table and rebuilding it from the event log yields the same values. `state_change` events are **audit snapshots, ignored during replay** — otherwise floor contributions get counted twice. The read path applies pure decay up to "now" and **does not write to the event log**. Temperature is carried to three adapters through `StreamRequest.temperature`.

**Tech Stack:** TypeScript ESM, `better-sqlite3`, Vitest, React 18 + Vite.

**Spec:** `docs/superpowers/specs/2026-10-26-karen-biological-brain-design.md` (§7, §15)

## Global Constraints

- No new dependencies. `package.json` does not change.
- Append-only event log and hash chain are preserved; no event is deleted/modified.
- Turkish UI strings; in-code identifiers are English, comments are Turkish.
- On Windows tests run single-threaded (`vitest.config.ts`); timer/clock tests are written with an **injected clock**, no real waiting.
- Values stay clamped to `[0,1]`; `NaN` never leaks out under any condition.
- Temperature range `[0.10, 1.00]`, floor `0.70`.
- Model delta: `|delta| ≤ 0.10`, at most one `feel` call per turn, reason required.
- Evidence rule (article 19) does not change in this phase; existing tests stay green.
- At the end of each phase: `npx tsc --noEmit` clean · `npm test` green · `npm run build` clean.
- Version goes to `1.2.0` in this phase (final task).

## Review Focus

Places where this phase is silent in the spec but will break first in real use:

1. **System clock moves backwards or jumps 12 hours forward** (sleep/wake, time zone change): decay must not produce a negative duration or `NaN`; the value must stay within `[0,1]`.
2. **Old database** (no `state_vector` table) is opened: the migration must run silently, the app must not fail to open.
3. **Local model ignores temperature** (llama.cpp/Ollama in some versions): the request must still succeed, no error produced.
4. **The `feel` tool receives a non-numeric / out-of-range delta**: it is clipped or rejected, the session does not drop.
5. **`feel` is called twice in the same turn**: the second is ignored, state does not change twice.
6. **Empty event log** (fresh install): default vector on the first turn, no division by zero.

---

### Task 1: Pure state dynamics

**Files:**
- Create: `server/brain/state.ts`
- Test: `test/state.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports).
- Produces:
  - `type Phase = 'gece' | 'sabah' | 'gunduz' | 'aksam'`
  - `type StateVector = { at: number; cortisol: number; dopamine: number; serotonin: number; fatigue: number; circadian: number; phase: Phase }`
  - `type EmotionKey = 'cortisol' | 'dopamine' | 'serotonin' | 'fatigue'`
  - `type StateSignal = { kind: 'error' } | { kind: 'crisis_words' } | { kind: 'tool_ok' } | { kind: 'new_project' } | { kind: 'correction' } | { kind: 'turn' } | { kind: 'context_bloat' } | { kind: 'task_done' } | { kind: 'feel'; emotion: EmotionKey; delta: number }`
  - `const BASELINE: Record<EmotionKey, number>`
  - `const HALF_LIFE_MS: Record<EmotionKey, number>`
  - `const MAX_MODEL_DELTA: 0.10`
  - `function phaseAt(now: number): Phase`
  - `function circadianAt(now: number): number`
  - `function initialState(now: number): StateVector`
  - `function decay(state: StateVector, now: number): StateVector`
  - `function applySignal(state: StateVector, signal: StateSignal, now: number): StateVector`
  - `function temperatureOf(state: StateVector): number`
  - `function gatesOf(state: StateVector): { crisis: boolean; creative: boolean; consolidate: boolean; tired: boolean; nightQuiet: boolean }`
  - `function statePromptBlock(state: StateVector): string`

Fixed values (spec §7.1, §7.2): floor `cortisol 0.10, dopamine 0.35, serotonin 0.50, fatigue 0.05`; half-life `cortisol 15 min, dopamine 40 min, serotonin 2 h, fatigue 8 h`.

- [ ] **Step 1: Write the failing test**

```ts
// test/state.test.ts
import { describe, it, expect } from 'vitest';
import {
  applySignal, circadianAt, decay, gatesOf, initialState, phaseAt,
  statePromptBlock, temperatureOf, MAX_MODEL_DELTA,
} from '../server/brain/state.js';

const DAY = 86_400_000;
// 2026-03-10 12:00 local time (gunduz)
const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();
const NIGHT = new Date(2026, 2, 10, 2, 0, 0).getTime();

describe('phaseAt / circadianAt', () => {
  it('returns the phases of the day by local time', () => {
    expect(phaseAt(new Date(2026, 2, 10, 2, 0).getTime())).toBe('gece');
    expect(phaseAt(new Date(2026, 2, 10, 8, 0).getTime())).toBe('sabah');
    expect(phaseAt(new Date(2026, 2, 10, 14, 0).getTime())).toBe('gunduz');
    expect(phaseAt(new Date(2026, 2, 10, 21, 0).getTime())).toBe('aksam');
  });

  it('circadian is between 0..1 and peaks at noon', () => {
    expect(circadianAt(NOON)).toBeCloseTo(1, 1);
    expect(circadianAt(NIGHT)).toBeGreaterThanOrEqual(0);
    expect(circadianAt(NIGHT)).toBeLessThan(0.2);
  });
});

describe('decay', () => {
  it('decays toward the floor with half-life', () => {
    const s = { ...initialState(NOON), cortisol: 0.9 };
    const after = decay(s, NOON + 15 * 60_000); // 1 half-life
    expect(after.cortisol).toBeCloseTo(0.10 + (0.9 - 0.10) / 2, 2);
  });

  it('negative duration and forward jump do not produce NaN', () => {
    const s = initialState(NOON);
    for (const t of [NOON - 5 * DAY, NOON + 400 * DAY]) {
      const out = decay(s, t);
      for (const key of ['cortisol', 'dopamine', 'serotonin', 'fatigue'] as const) {
        expect(Number.isFinite(out[key])).toBe(true);
        expect(out[key]).toBeGreaterThanOrEqual(0);
        expect(out[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('night fatigue floor rises', () => {
    const out = decay({ ...initialState(NOON), fatigue: 0.05 }, NIGHT);
    expect(out.phase).toBe('gece');
    expect(out.fatigue).toBeGreaterThan(0.05);
  });
});

describe('applySignal', () => {
  it('error spikes cortisol, value does not exceed 1', () => {
    const out = applySignal(initialState(NOON), { kind: 'error' }, NOON);
    expect(out.cortisol).toBeCloseTo(0.45, 2);
    expect(applySignal(out, { kind: 'error' }, NOON).cortisol).toBeLessThanOrEqual(1);
  });

  it('crisis word adds cortisol + fatigue', () => {
    const out = applySignal(initialState(NOON), { kind: 'crisis_words' }, NOON);
    expect(out.cortisol).toBeCloseTo(0.40, 2);
    expect(out.fatigue).toBeCloseTo(0.10, 2);
  });

  it('successful tool adds serotonin and dopamine', () => {
    const out = applySignal(initialState(NOON), { kind: 'tool_ok' }, NOON);
    expect(out.serotonin).toBeCloseTo(0.62, 2);
    expect(out.dopamine).toBeCloseTo(0.43, 2);
  });

  it('model delta cannot exceed the limit', () => {
    const out = applySignal(initialState(NOON), { kind: 'feel', emotion: 'cortisol', delta: 0.9 }, NOON);
    expect(out.cortisol).toBeCloseTo(0.10 + MAX_MODEL_DELTA, 2);
  });

  it('non-numeric delta is ignored', () => {
    const out = applySignal(initialState(NOON), { kind: 'feel', emotion: 'dopamine', delta: Number.NaN }, NOON);
    expect(out.dopamine).toBeCloseTo(0.35, 5);
  });

  it('same signal sequence yields the same vector (determinism)', () => {
    const run = () => {
      let s = initialState(NOON);
      for (const sig of [{ kind: 'turn' }, { kind: 'error' }, { kind: 'tool_ok' }] as const) s = applySignal(s, sig, NOON);
      return s;
    };
    expect(run()).toEqual(run());
  });
});

describe('temperatureOf', () => {
  it('drops in crisis', () => {
    const s = { ...initialState(NOON), cortisol: 0.95, dopamine: 0.1, fatigue: 0.1 };
    expect(temperatureOf(s)).toBeLessThanOrEqual(0.35);
  });

  it('rises when dopamine is high and does not exceed 1', () => {
    const s = { ...initialState(NOON), cortisol: 0, dopamine: 1, fatigue: 0 };
    expect(temperatureOf(s)).toBeGreaterThanOrEqual(0.95);
    expect(temperatureOf(s)).toBeLessThanOrEqual(1);
  });

  it('never goes below 0.10', () => {
    const s = { ...initialState(NOON), cortisol: 1, dopamine: 0, fatigue: 1 };
    expect(temperatureOf(s)).toBeGreaterThanOrEqual(0.1);
  });
});

describe('gatesOf / statePromptBlock', () => {
  it('thresholds open the right gate', () => {
    const crisis = gatesOf({ ...initialState(NOON), cortisol: 0.71 });
    expect(crisis.crisis).toBe(true);
    expect(gatesOf({ ...initialState(NOON), dopamine: 0.7 }).creative).toBe(true);
    expect(gatesOf({ ...initialState(NOON), serotonin: 0.7 }).consolidate).toBe(true);
    expect(gatesOf({ ...initialState(NOON), fatigue: 0.75 }).tired).toBe(true);
    expect(gatesOf({ ...initialState(NIGHT), fatigue: 0.6 }).nightQuiet).toBe(true);
  });

  it('crisis block forbids jokes and has a crisis tag', () => {
    const text = statePromptBlock({ ...initialState(NOON), cortisol: 0.9 });
    expect(text).toContain('Inner state');
    expect(text).toContain('CRISIS');
    expect(text).toContain('No jokes');
    expect(text).not.toContain('proactive');
  });

  it('tired block suggests sleep', () => {
    expect(statePromptBlock({ ...initialState(NOON), fatigue: 0.8 })).toContain('sleep');
  });

  it('calm state has no gate sentence, only numbers', () => {
    const text = statePromptBlock(initialState(NOON));
    expect(text).toContain('cortisol');
    expect(text).not.toContain('CRISIS');
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/state.test.ts`
Expected: FAIL — `Failed to resolve import "../server/brain/state.js"`

- [ ] **Step 3: Write `server/brain/state.ts`**

Formulas (spec §7.2):
- Decay: `v' = base + (v − base) · 0.5^(elapsed / halfLife)`; `elapsed = max(0, now − state.at)`.
- If night (`phase === 'gece'`) the fatigue floor is `+0.15`.
- `circadianAt`: `0.5 + 0.5 · sin(((yerelSaat + dakika/60) − 6) / 24 · 2π)`, clamped to `[0,1]`.
- `temperatureOf`: `clamp(0.70 + 0.35·dopamine − 0.45·cortisol − 0.20·fatigue, 0.10, 1.00)`.
- Signal contributions verbatim from the spec §7.2 table: `error +0.35 cortisol`; `crisis_words +0.30 cortisol, +0.05 fatigue`; `tool_ok +0.12 serotonin, +0.08 dopamine`; `new_project +0.20 dopamine`; `correction +0.15 cortisol`; `turn +0.02 fatigue`; `context_bloat +0.10 fatigue`; `task_done +0.10 serotonin`; `feel` → `clamp(delta, ±MAX_MODEL_DELTA)`, ignore if not `Number.isFinite`.
- After every write all emotions are `clamp01`; `at = now`, `circadian`/`phase` are recomputed.
- `statePromptBlock` output: `## Inner state (automatic, refreshed every turn)` heading + one line of numbers (`cortisol 0.82 · dopamine 0.31 · serotonin 0.44 · fatigue 0.28 · phase: gece · temperature 0.34`) + one line per open gate:
  - `crisis`: `Mode: CRISIS. No jokes, no embellishment. Write only diagnosis, command and fix.`
  - `creative`: `Mode: R&D. Offer at most 2 short proactive engineering suggestions.`
  - `consolidate`: `Mode: Consolidation. Refactor and test suggestions take priority.`
  - `tired`: `Mode: Tired. Context is muddled; suggest sleep + distillation to the user.`
  - `nightQuiet`: `Mode: Night. Answer short, calm, thoughtful.`

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/state.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add server/brain/state.ts test/state.test.ts
git commit -m "feat(brain): pure state dynamics (hormone, circadian, gates)"
```

---

### Task 2: State projection rebuilt from the event log

**Files:**
- Create: `server/brain/store.ts`
- Modify: `server/store/events.ts` (`EventKind` union gains 3 members)
- Test: `test/state-store.test.ts`

**Interfaces:**
- Consumes: all `state.ts` exports from Task 1; `EventLog`, `StoredEvent`.
- Produces:
  - `EventKind` += `'state_signal' | 'state_feel' | 'state_change'`
  - `class StateStore`:
    - `constructor(log: EventLog, now?: () => number)`
    - `current(): StateVector` — `sync()` + decay to "now", **does not write**
    - `sync(): void` — applies unprocessed events from the event log to the projection (incremental)
    - `record(signal: StateSignal): void` — if `feel` writes `state_feel`, otherwise writes and applies a `state_signal` event for **non-derivable** signals only
    - `snapshot(): void` — `state_change` audit event + `state_history` row
    - `apply(event: StoredEvent): void` — applies a single event to the projection
    - `replay(): StateVector` — drops the table, rebuilds from the event log and decays to "now"
    - `history(limit?: number): StateVector[]`
    - `temperature(): number`

**Double-counting ban (critical).** Derivable signals are computed **only** from
event log events; `SessionManager` does **not** additionally `record` them. Otherwise they
would be counted both from the `message` event and from the `state_signal` event, and
state would double.

| Signal | How it arrives |
|---|---|
| `error`, `tool_ok`, `correction`, `turn`, `crisis_words`, `new_project` | **Derived** (table below). `record` is not called |
| `context_bloat`, `task_done` | **Not derivable** → `SessionManager` calls `record` |
| `feel` | Written as a `state_feel` event (its own event) |

`current()` calls `sync()` on every call: it reads from after the last processed event id
and advances with `decay(state, event.ts)`. Thus **live state and `replay()` are exactly
the same** — the plan tests this.

**Replay rules (spec §6.4 + §15/1 — no double counting):**

| Event | Signal |
|---|---|
| `error` | `error` |
| `tool_result` and `payload.ok === true` | `tool_ok` |
| `memory_score` and `op` ∈ `correct \| supersede` | `correction` |
| `message` and `role === 'user'` | `turn` + `crisis_words` if the text contains a crisis word + `new_project` if it contains a project/idea word |
| `state_signal` | `payload.signal` |
| `state_feel` | `{ kind: 'feel', emotion, delta }` |
| `state_change` | **ignored** (audit snapshot) |

`decay(state, event.ts)` is called between events, so the real time difference is counted.

- [ ] **Step 1: Write the failing test**

```ts
// test/state-store.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { StateStore } from '../server/brain/store.js';
import { initialState } from '../server/brain/state.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup() {
  let clock = NOON;
  const log = new EventLog(':memory:');
  const state = new StateStore(log, () => clock);
  return { log, state, setClock: (t: number) => (clock = t) };
}

describe('StateStore', () => {
  it('empty event log returns the default vector', () => {
    const { state } = setup();
    const s = state.current();
    expect(s.cortisol).toBeCloseTo(0.1, 2);
    expect(s.phase).toBe('gunduz');
  });

  it('read path does not write events to the log', () => {
    const { log, state } = setup();
    const before = log.read().length;
    state.current();
    state.current();
    expect(log.read().length).toBe(before);
  });

  it('record writes and applies a non-derivable signal', () => {
    const { log, state } = setup();
    state.record({ kind: 'context_bloat' });
    expect(state.current().fatigue).toBeGreaterThan(0.14);
    expect(log.read().some((e) => e.kind === 'state_signal')).toBe(true);
  });

  it('live state and rebuild from the log do not diverge', () => {
    const { log, state, setClock } = setup();
    log.append('message', 'user', 's1', { role: 'user' }, 'urgent, system crashed');
    const live = state.current();
    setClock(NOON + 5 * 60_000);
    expect(state.replay()).toEqual(state.current());
    expect(live.cortisol).toBeGreaterThan(0.35);
  });

  it('the same message is not counted twice (derived signal, single source)', () => {
    const { log, state } = setup();
    log.append('message', 'user', 's1', { role: 'user' }, 'urgent');
    const first = state.current().cortisol;
    const second = state.current().cortisol;
    expect(second).toBeCloseTo(first, 5);
    expect(first).toBeCloseTo(0.40, 2);
  });

  it('same values when the table is dropped and rebuilt from the log', () => {
    const { log, state, setClock } = setup();
    log.append('error', 'system', 's1', { message: 'boom' });
    log.append('tool_result', 'system', 's1', { tool: 'tsc', ok: true }, 'ok');
    state.record({ kind: 'feel', emotion: 'dopamine', delta: 0.05 });
    setClock(NOON + 30 * 60_000);

    const before = state.current();
    const rebuilt = state.replay();
    expect(rebuilt.cortisol).toBeCloseTo(before.cortisol, 5);
    expect(rebuilt.dopamine).toBeCloseTo(before.dopamine, 5);
    expect(rebuilt.serotonin).toBeCloseTo(before.serotonin, 5);
    expect(state.current()).toEqual(before);
  });

  it('state_change is not counted during replay (no double counting)', () => {
    const { log, state } = setup();
    log.append('error', 'system', 's1', { message: 'boom' });
    const once = state.replay();
    state.snapshot(); // audit event
    const twice = state.replay();
    expect(twice.cortisol).toBeCloseTo(once.cortisol, 5);
    expect(log.read().some((e) => e.kind === 'state_change')).toBe(true);
  });

  it('same log replayed twice is exactly the same', () => {
    const { log, state } = setup();
    log.append('message', 'user', 's1', { role: 'user' }, 'urgent, system crashed');
    log.append('error', 'system', 's1', { message: 'x' });
    expect(state.replay()).toEqual(state.replay());
  });

  it('migration runs silently on an old database', () => {
    const log = new EventLog(':memory:');
    log.database.exec('DROP TABLE IF EXISTS state_vector');
    expect(() => new StateStore(log)).not.toThrow();
  });

  it('history returns a limited number of rows', () => {
    const { state } = setup();
    state.snapshot();
    state.snapshot();
    expect(state.history(1)).toHaveLength(1);
  });

  it('temperature is derived from the vector', () => {
    const { log, state } = setup();
    log.append('error', 'system', 's1', { message: 'x' });
    expect(state.temperature()).toBeLessThan(0.7);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/state-store.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Write `EventKind` and `StateStore`**

`server/store/events.ts`: add `'state_signal' | 'state_feel' | 'state_change'` to the union (no other change).

`server/brain/store.ts`: schema `state_vector` (single row, `CHECK (id = 1)`) and `state_history` (spec §7.1); migration via `PRAGMA table_info` with `ALTER TABLE` (add missing columns). `apply()` converts the event to a signal per the table above, calls `applySignal` and `INSERT OR REPLACE`s the single row. `sync()` reads from after the last processed event id (`state_vector.last_event_id` column) and applies it. `replay()` runs `DELETE FROM state_vector; DELETE FROM state_history;` then `apply` over `log.read()`. `snapshot()` writes a `state_change` event (`derived: true`) and adds a row to `state_history`.

**Critical:** `current()` only does `sync()` + `decay`; it does **not** call `log.append` and does not write `state_change`. The last processed event id is kept in `state_vector.last_event_id` (during migration `ALTER TABLE ... ADD COLUMN last_event_id INTEGER NOT NULL DEFAULT 0`).

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/state-store.test.ts test/state.test.ts`
Expected: PASS

- [ ] **Step 5: Are all tests green?**

Run: `npm test`
Expected: PASS (existing 360 + new)

- [ ] **Step 6: Commit**

```bash
git add server/store/events.ts server/brain/store.ts test/state-store.test.ts
git commit -m "feat(brain): state projection and rebuild from the event log"
```

---

### Task 3: Carry temperature to providers

**Files:**
- Modify: `server/engine/types.ts` (`StreamRequest.temperature?: number`)
- Modify: `server/engine/providers/openai-compatible.ts:45-55`
- Modify: `server/engine/providers/anthropic.ts:55-62`
- Modify: `server/engine/providers/google.ts` (`generationConfig`)
- Test: `test/provider-temperature.test.ts`

**Interfaces:**
- Consumes: existing provider adapters.
- Produces: `temperature?: number` in `StreamRequest`; the three adapters write it into the body, and if `undefined` the **field is not sent at all**.

- [ ] **Step 1: Write the failing test**

```ts
// test/provider-temperature.test.ts
import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../server/engine/providers/openai-compatible.js';
import { AnthropicProvider } from '../server/engine/providers/anthropic.js';
import { GoogleProvider } from '../server/engine/providers/google.js';

function capture() {
  let body = '';
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    body = String(init?.body ?? '');
    return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, body: () => body };
}

const messages = [{ role: 'user' as const, content: 'hello' }];

async function drain(iter: AsyncIterable<unknown>) {
  for await (const _ of iter) void _;
}

describe('temperature carrying', () => {
  it('openai compatible writes temperature into the body', async () => {
    const c = capture();
    const p = new OpenAICompatibleProvider({ name: 'x', baseUrl: 'http://x/v1', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [], temperature: 0.25 }));
    expect(JSON.parse(c.body()).temperature).toBe(0.25);
  });

  it('openai compatible does not send the field when undefined', async () => {
    const c = capture();
    const p = new OpenAICompatibleProvider({ name: 'x', baseUrl: 'http://x/v1', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [] }));
    expect('temperature' in JSON.parse(c.body())).toBe(false);
  });

  it('anthropic writes temperature into the body', async () => {
    const c = capture();
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [], temperature: 0.9 }));
    expect(JSON.parse(c.body()).temperature).toBe(0.9);
  });

  it('google writes temperature into generationConfig', async () => {
    const c = capture();
    const p = new GoogleProvider({ apiKey: 'k', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [], temperature: 0.4 }));
    expect(JSON.parse(c.body()).generationConfig.temperature).toBe(0.4);
  });

  it('invalid temperature is clipped', async () => {
    const c = capture();
    const p = new OpenAICompatibleProvider({ name: 'x', baseUrl: 'http://x/v1', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [], temperature: 5 }));
    expect(JSON.parse(c.body()).temperature).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/provider-temperature.test.ts`
Expected: FAIL (no temperature / TS error)

- [ ] **Step 3: Implement**

`types.ts`:
```ts
export type StreamRequest = {
  model: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  /** 0..1 — comes from the state vector; provider default if omitted. */
  temperature?: number;
  signal?: AbortSignal;
};
```

Shared helper (can be exported in one of the adapter files, e.g. not next to `sse.ts` — each adapter can use a single line internally):
```ts
const temp = (t?: number) => (typeof t === 'number' && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : undefined);
```
In each adapter, into the body: `...(temp(req.temperature) === undefined ? {} : { temperature: temp(req.temperature) })`.

In Google it goes into the existing `generationConfig: { maxOutputTokens: 4096 }`.

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/provider-temperature.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/engine/types.ts server/engine/providers/*.ts test/provider-temperature.test.ts
git commit -m "feat(engine): carry temperature into provider requests"
```

---

### Task 4: Prompt injection + temperature (session loop)

**Files:**
- Modify: `server/engine/loop.ts` (`AgentOptions.temperature`, `provider.stream` call)
- Modify: `server/sessions.ts` (`SessionDeps.state`, `runTurn`, `systemPrompt`)
- Modify: `server/serve.ts` (set up `StateStore`, pass it to `SessionManager`)
- Test: `test/session-state.test.ts`

**Interfaces:**
- Consumes: `StateStore` (Task 2), `statePromptBlock` (Task 1), `StreamRequest.temperature` (Task 3).
- Produces:
  - `AgentOptions.temperature?: number`
  - `SessionDeps.state?: StateStore`
  - `RunningServer.state: StateStore`

- [ ] **Step 1: Write the failing test**

```ts
// test/session-state.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { SessionManager } from '../server/sessions.js';
import { StateStore } from '../server/brain/store.js';
import type { StreamRequest } from '../server/engine/types.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();

function provider() {
  const requests: StreamRequest[] = [];
  return {
    requests,
    p: {
      name: 'rec',
      async *stream(req: StreamRequest) {
        requests.push(req);
        yield { type: 'text' as const, text: 'ok' };
        yield { type: 'done' as const, stopReason: 'end' as const };
      },
    },
  };
}

function setup() {
  const log = new EventLog(':memory:');
  const state = new StateStore(log, () => NOON);
  const rec = provider();
  const sessions = new SessionManager({
    provider: rec.p,
    model: 'm',
    log,
    state,
    approve: async () => true,
    onEvent: () => undefined,
  });
  const brain = sessions.create({ role: 'brain' });
  return { log, state, sessions, brain, rec };
}

describe('state injection', () => {
  it('system prompt contains the inner state block', async () => {
    const { sessions, brain, rec } = setup();
    await sessions.send(brain.id, 'hello');
    const system = rec.requests[0]!.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('Inner state');
    expect(system).toContain('cortisol');
  });

  it('temperature reaches the request and is within 0.10-1.00', async () => {
    const { sessions, brain, rec } = setup();
    await sessions.send(brain.id, 'hello');
    const t = rec.requests[0]!.temperature;
    expect(typeof t).toBe('number');
    expect(t!).toBeGreaterThanOrEqual(0.1);
    expect(t!).toBeLessThanOrEqual(1);
  });

  it('crisis message raises cortisol and shows up in the number line', async () => {
    const { sessions, brain, rec, state } = setup();
    await sessions.send(brain.id, 'urgent, system crashed');
    const system = rec.requests.at(-1)!.messages.find((m) => m.role === 'system')!.content;
    expect(state.current().cortisol).toBeGreaterThan(0.35);
    // The prompt number line reflects the real vector.
    expect(system).toMatch(/cortisol 0\.[3-9]\d/);
  });

  it('two crisis messages open the crisis gate', async () => {
    const { sessions, brain, rec } = setup();
    await sessions.send(brain.id, 'urgent crashed');
    await sessions.send(brain.id, 'urgent still broken');
    const system = rec.requests.at(-1)!.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('CRISIS');
  });

  it('a failed turn does not corrupt state (error path)', async () => {
    const log = new EventLog(':memory:');
    const state = new StateStore(log, () => NOON);
    const sessions = new SessionManager({
      provider: {
        name: 'boom',
        // eslint-disable-next-line require-yield
        async *stream() {
          throw new Error('no network');
        },
      },
      model: 'm',
      log,
      state,
      approve: async () => true,
      onEvent: () => undefined,
    });
    const brain = sessions.create({ role: 'brain' });
    const result = await sessions.send(brain.id, 'hello');
    expect(result.ok).toBe(false);
    expect(Number.isFinite(state.current().cortisol)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/session-state.test.ts`
Expected: FAIL — `state` unknown / no prompt block.

- [ ] **Step 3: Implement**

`loop.ts`: add `temperature?: number` to `AgentOptions`; in the `provider.stream` call use `...(opts.temperature === undefined ? {} : { temperature: opts.temperature })`.

`sessions.ts`:
- `SessionDeps.state?: StateStore`
- `runTurn`: **`state.current()` is read AFTER the user message is written to the event log**
  (after the `log.append('message', ...)` line), otherwise the "urgent" signal
  of the same turn would not show up in the prompt. `const snapshotState = this.deps.state?.current();`
- In the `runAgent` call use `...(snapshotState ? { temperature: temperatureOf(snapshotState) } : {})` — `temperatureOf` is imported.
- **`record` ONLY for non-derivable signals** (double-counting law, Task 2):
  if the turn finished successfully, `record({ kind: 'task_done' })`; if the total
  character count of `session.messages` is `> 240_000`, `record({ kind: 'context_bloat' })`.
  `turn`, `crisis_words`, `new_project`, `error`, `tool_ok`, `correction` are **not written** —
  they are derived from event log events by `StateStore.sync()`. `current()`, read after the
  user message is written to the log, sees the signal in the same turn.
- At the end of the turn `snapshot()` is called (audit snapshot, not counted during replay).
- Add a third parameter `state?: StateVector` to the `systemPrompt(session, recall)` signature;
  the block is added **after** identity and **before** skills (`core → state → skills`).

`serve.ts`: `const state = new StateStore(log);` → pass `state` to `SessionManager` and `state` to `RunningServer`.

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/session-state.test.ts`
Expected: PASS

- [ ] **Step 5: All tests + type check**

Run: `npx tsc --noEmit && npm test`
Expected: clean + PASS

- [ ] **Step 6: Commit**

```bash
git add server/engine/loop.ts server/sessions.ts server/serve.ts test/session-state.test.ts
git commit -m "feat(engine): wire the state vector into prompt and temperature"
```

---

### Task 5: `feel` tool (the model's own feeling)

**Files:**
- Create: `server/engine/tools/state.ts`
- Modify: `server/sessions.ts` (tool registration)
- Test: `test/feel-tool.test.ts`

**Interfaces:**
- Consumes: `StateStore.record`, `MAX_MODEL_DELTA`, `EmotionKey`.
- Produces: `function stateTools(state: StateStore): Tool[]` → a single tool `feel`.

**Rules:** `access: 'read'` (no approval needed) · at most one successful call per turn (`usedThisTurn` flag inside the tool instance; `SessionManager` builds a fresh tool list every turn, so the flag resets per turn) · reject if `reason` is empty · reject if `delta` is not a finite number · clipped to ±0.10.

- [ ] **Step 1: Write the failing test**

```ts
// test/feel-tool.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { StateStore } from '../server/brain/store.js';
import { stateTools } from '../server/engine/tools/state.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();
const ctx = { cwd: '.', signal: new AbortController().signal };

function setup() {
  const log = new EventLog(':memory:');
  const state = new StateStore(log, () => NOON);
  const feel = stateTools(state).find((t) => t.def.name === 'feel')!;
  return { log, state, feel };
}

describe('feel tool', () => {
  it('does not ask for approval (read class)', () => {
    expect(setup().feel.access).toBe('read');
  });

  it('updates the emotion with a reason', async () => {
    const { state, feel } = setup();
    const out = await feel.run({ emotion: 'dopamine', delta: 0.05, reason: 'new idea looks interesting' }, ctx);
    expect(out.ok).toBe(true);
    expect(state.current().dopamine).toBeGreaterThan(0.35);
  });

  it('out-of-range delta is clipped', async () => {
    const { state, feel } = setup();
    await feel.run({ emotion: 'cortisol', delta: 5, reason: 'excessive' }, ctx);
    expect(state.current().cortisol).toBeCloseTo(0.2, 2);
  });

  it('call without a reason is rejected', async () => {
    const { feel } = setup();
    const out = await feel.run({ emotion: 'dopamine', delta: 0.05 }, ctx);
    expect(out.ok).toBe(false);
  });

  it('non-numeric delta is rejected', async () => {
    const { feel } = setup();
    const out = await feel.run({ emotion: 'dopamine', delta: 'too much', reason: 'x' }, ctx);
    expect(out.ok).toBe(false);
  });

  it('unknown emotion is rejected', async () => {
    const { feel } = setup();
    const out = await feel.run({ emotion: 'anger', delta: 0.05, reason: 'x' }, ctx);
    expect(out.ok).toBe(false);
  });

  it('only one call per turn is valid', async () => {
    const { state, feel } = setup();
    await feel.run({ emotion: 'dopamine', delta: 0.05, reason: 'one' }, ctx);
    const second = await feel.run({ emotion: 'dopamine', delta: 0.05, reason: 'two' }, ctx);
    expect(second.ok).toBe(false);
    expect(state.current().dopamine).toBeCloseTo(0.40, 2);
  });

  it('event is written to the log as state_feel', async () => {
    const { log, feel } = setup();
    await feel.run({ emotion: 'serotonin', delta: 0.03, reason: 'good job' }, ctx);
    expect(log.read().some((e) => e.kind === 'state_feel')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/feel-tool.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Implement**

`server/engine/tools/state.ts` — `stateTools(state)`:

```ts
{
  access: 'read',
  def: {
    name: 'feel',
    description: 'Propose a small contribution to your own inner state (at most ±0.10). Trauma, identity and approval cannot be changed with this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        emotion: { type: 'string', description: 'cortisol | dopamine | serotonin | fatigue' },
        delta: { type: 'number', description: '-0.10 .. 0.10' },
        reason: { type: 'string', description: 'Why this feeling (evidence)' },
      },
      required: ['emotion', 'delta', 'reason'],
    },
  },
  async run(args) { /* validate → clip → state.record({kind:'feel',...}) */ },
}
```

`sessions.ts`: add to the tool list `if (this.deps.state) tools.push(...stateTools(this.deps.state));`

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/feel-tool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/engine/tools/state.ts server/sessions.ts test/feel-tool.test.ts
git commit -m "feat(engine): limited model feeling via the feel tool"
```

---

### Task 6: `/api/state` and the dashboard field

**Files:**
- Modify: `server/http/server.ts` (`KarenServerOptions.state`, `GET /api/state`)
- Modify: `server/dashboard.ts` (`DashboardData.state`)
- Modify: `server/serve.ts` (wire it up)
- Test: `test/http-state.test.ts`, `test/dashboard.test.ts` (one test added to the existing file)

**Interfaces:**
- Consumes: `StateStore` (Task 2), not `statePromptBlock` — only the vector + temperature.
- Produces:
  - `KarenServerOptions.state?: { current: () => StateVector; history: (limit?: number) => StateVector[]; temperature: () => number }`
  - `GET /api/state` → `{ state: StateVector, temperature: number, history: StateVector[] }`
  - `DashboardData.state?: { cortisol; dopamine; serotonin; fatigue; circadian; phase; temperature }`

- [ ] **Step 1: Write the failing test**

```ts
// test/http-state.test.ts
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
import { StateStore } from '../server/brain/store.js';

const TOKEN = 't';
const servers: KarenServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'karen-http-state-'));
  const log = new EventLog(':memory:');
  const state = new StateStore(log);
  // Derived signal: comes from an event log event, not additionally recorded.
  log.append('error', 'system', 's1', { message: 'boom' });
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
    model: 'm',
    log,
    state,
    approve: async () => true,
    onEvent: (e) => hub.send(e),
  });
  const server = createKarenServer({
    repos: new RepoStore(join(dir, 'repos.json')),
    sessions,
    approvals: new ApprovalBroker(),
    hub,
    token: TOKEN,
    rootDir: dir,
    state: {
      current: () => state.current(),
      history: (limit) => state.history(limit),
      temperature: () => state.temperature(),
    },
  });
  servers.push(server);
  return { server, state };
}

describe('GET /api/state', () => {
  it('requires a token', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.status).toBe(401);
  });

  it('returns the vector, temperature and history', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/state?token=${TOKEN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { cortisol: number }; temperature: number; history: unknown[] };
    expect(body.state.cortisol).toBeGreaterThan(0.3);
    expect(body.temperature).toBeLessThanOrEqual(1);
    expect(Array.isArray(body.history)).toBe(true);
  });
});
```

Test to be added to `test/dashboard.test.ts`:

```ts
it('state vector enters the dashboard', () => {
  const { log, memory, approvals } = setup();
  const data = buildDashboard({
    sessions: [],
    memory,
    approvals,
    logEvents: log.read(),
    voice,
    state: { cortisol: 0.8, dopamine: 0.3, serotonin: 0.5, fatigue: 0.2, circadian: 0.9, phase: 'gunduz' as const, at: 0, temperature: 0.3 },
  });
  expect(data.state?.cortisol).toBe(0.8);
  expect(data.state?.phase).toBe('gunduz');
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run test/http-state.test.ts test/dashboard.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`http/server.ts`: `if (parts[1] === 'state' && req.method === 'GET') { sendJson(res, 200, { state: opts.state.current(), temperature: opts.state.temperature(), history: opts.state.history(20) }); return; }` — the token check is already above. If there is no `state`, `404 { error: 'state disabled' }`.

`dashboard.ts`: `DashboardData.state?: StateVector & { temperature: number }`; if `input.state` is given it is copied as-is.

`serve.ts`: in the `dashboard()` call `state: { ...state.current(), temperature: state.temperature() }`.

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/http-state.test.ts test/dashboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/http/server.ts server/dashboard.ts server/serve.ts test/http-state.test.ts test/dashboard.test.ts
git commit -m "feat(http): expose the state vector to the API and dashboard"
```

---

### Task 7: State strip in the UI

**Files:**
- Create: `app/src/components/StateStrip.tsx`
- Modify: `app/src/components/CommandCenter.tsx` (strip in the system panel)
- Modify: `app/src/command.css` (mini bar styles)
- Test: none (pure view); verification `npm run app:build` + live `/api/state`.

**Interfaces:**
- Consumes: `getJson` (`app/src/api.ts`), `GET /api/state`.
- Produces: `export function StateStrip()` — fetches its own data every 5 s.

- [ ] **Step 1: Write `StateStrip.tsx`**

`GET /api/state` → labeled mini bars for the 4 hormones (`cortisol` red, `dopamine` blue, `serotonin` green, `fatigue` gray), a phase label and temperature (`0.34`). Returns `null` if there is no data (does not draw an empty box). Labels: `cortisol`, `dopamine`, `serotonin`, `fatigue`; phase mapping `gece → night`, `sabah → morning`, `gunduz → day`, `aksam → evening`.

- [ ] **Step 2: Place it in the system panel**

Add `<StateStrip />` to the `.cc-monitor` panel in `CommandCenter.tsx`, **above** the `.cc-gauges` block. Add the import.

- [ ] **Step 3: Style**

At the end of `app/src/command.css`, rules for `.cc-state-strip`, `.cc-state-bar`, `.cc-state-bar span` (height 4px, rounded, colors via inline `style`).

- [ ] **Step 4: Build and type check**

Run: `npx tsc --noEmit && npm run app:build`
Expected: temiz + `✓ built in`

- [ ] **Step 5: Commit**

```bash
git add app/src/components/StateStrip.tsx app/src/components/CommandCenter.tsx app/src/command.css
git commit -m "feat(ui): state strip in the command center"
```

---

### Task 8: Cut the release and verify end to end

**Files:**
- Modify: `package.json` (`version: 1.2.0`)
- Modify: `CHANGELOG.md` (1.2.0 entry)

**Interfaces:**
- Consumes: Task 1–7.
- Produces: releasable `v1.2.0`.

- [ ] **Step 1: Version and changelog**

`package.json` `version` → `1.2.0`. At the top of `CHANGELOG.md` add `## [1.2.0] — 2026-10-26` and a "Phase 1 — state core" heading: `state_vector`, hormone dynamics, circadian, temperature carrying, `feel` tool, `/api/state`, UI strip.

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: clean + all tests PASS + build succeeds

- [ ] **Step 3: Live verification**

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;" + $env:Path
$d = Join-Path $env:TEMP "karen-v12"
Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
  -ArgumentList "node_modules/tsx/dist/cli.mjs","server/cli.ts","serve","--port","7462","--data",$d `
  -RedirectStandardOutput "$env:TEMP\v12.log" -WindowStyle Hidden
Start-Sleep -Seconds 8
$tok = [regex]::Match((Get-Content "$env:TEMP\v12.log" -Raw), 'token=([a-f0-9]+)').Groups[1].Value
$s = Invoke-RestMethod "http://127.0.0.1:7462/api/state?token=$tok"
"cortisol=$($s.state.cortisol) phase=$($s.state.phase) temp=$($s.temperature)"
$dash = Invoke-RestMethod "http://127.0.0.1:7462/api/dashboard?token=$tok"
"dashboard state: $($dash.state.cortisol)"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*--port*7462*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Expected: both lines return numbers, `cortisol` between 0..1; the process is closed.

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: v1.2.0 — state core"
```

---

## Phase 1 acceptance summary

- [ ] `state_vector` table is rebuilt from the event log; dropping and rebuilding the table yields the same values
- [ ] `state_change` is not counted during replay (double-counting test)
- [ ] The read path does not write to the event log
- [ ] Cortisol ≥ 0.70 → CRISIS in the prompt + temperature ≤ 0.50
- [ ] Dopamine ≥ 0.70 → temperature ≥ 0.95 + creative gate
- [ ] Fatigue ≥ 0.75 → sleep suggestion line
- [ ] `feel` is clipped to ±0.10, calls without a reason / second calls in a turn are rejected
- [ ] No `NaN` on clock backward/forward jumps
- [ ] Old database migration is silent
- [ ] All three adapters carry temperature, no field when `undefined`
- [ ] `/api/state` and the dashboard state field are live
- [ ] UI shows 4 bars + phase + temperature
