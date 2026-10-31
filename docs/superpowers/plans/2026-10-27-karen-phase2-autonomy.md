# KAREN Phase 2 — Autonomous Processes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KAREN learns on its own while the user is away (DMN), tells what it found in one sentence when they return, and leaves a list awaiting approval in the morning — with nothing running while the app is closed.

**Architecture:** An `Autonomy` controller is driven by calling `tick(now)` with an injected clock (the real `setInterval` only calls it; tests tick directly). When conditions hold, it opens an **autonomous session** with a restricted tool set, distills its output in the same turn, and leaves a single line in the `inbox` projection. Autonomous sessions cannot wait for approval: the session-aware approver only auto-passes network reads and instantly rejects everything else. `sleep()` skips autonomous sessions (no feedback loop).

**Tech Stack:** TypeScript ESM, better-sqlite3, Vitest, React 18 + Vite.

**Spec:** `docs/superpowers/specs/2026-10-26-karen-biological-brain-design.md` (§8, §15/3-7)

## Global Constraints

- No new dependencies. The `package.json` dependencies do not change.
- The append-only event log and hash chain are preserved; no event is deleted or modified.
- **No process runs while the app is closed:** every timer is cleared inside `RunningServer.close()`; a test verifies this.
- Time tests use an **injected clock** + `tick(now)`; no real waiting.
- An autonomous session cannot wait for approval: an autonomous turn that lands in `waiting` is forbidden.
- An autonomous session does **not** register write/exec tools; network reads (`fetch_url`, `web_search`) only while `autonomy.research` is on and with automatic approval.
- The evidence rule (article 19) is preserved and tightened: every URL in a note must appear verbatim in the body of a tool result in the same block.
- Turkish interface text; code identifiers English, comments Turkish.
- At the end of every phase: `npx tsc --noEmit` clean · `npm test` green · `npm run build` clean.

## Review Focus

Where the spec is silent and real use will break first:

1. **The user is at the desk but doing nothing** — the interface polls `/api/dashboard` every 5 s; if polling counts as activity, the DMN never runs. Likewise, the window can stay open while the user is truly gone.
2. **An autonomous turn waiting for approval** — if a non-network tool call lands in `waiting` inside an autonomous session, it stays locked all night and the queue fills by morning.
3. **Self-feeding memory** — if notes written by the DMN are distilled again the next night, duplicate notes breed.
4. **No network / site HTML changed** — `web_search` must not invent results; it must return `{ok:false}`.
5. **The same research repeated every turn** — if cooldown and the daily cap do not work, the same topic is scanned 40 times overnight.
6. **Closed app, leftover timer** — the next `tick` after `close()` must do nothing.
7. **Restart** — the inbox must be persistent and the same line must not be written twice.

---

### Task 1: Autonomy settings

**Files:**
- Modify: `server/settings.ts` (type + defaults + sanitize)
- Test: `test/settings.test.ts` (append to existing file)

**Interfaces:**
- Consumes: existing `Settings`, `DEFAULT_SETTINGS`, `sanitize`.
- Produces:
  ```ts
  export type AutonomySettings = {
    enabled: boolean;      // default false — the user turns it on
    idleMinutes: number;   // 5..240, default 30
    dailyRuns: number;     // 0..96, default 24
    research: boolean;     // default true (effective while enabled is on)
  };
  // Add to Settings: autonomy: AutonomySettings
  ```

- [ ] **Step 1: Write the failing test**

```ts
// inside test/settings.test.ts
it('autonomy settings are defaulted and clamped', () => {
  const store = new SettingsStore(dir(), {});
  expect(store.get().autonomy).toEqual({ enabled: false, idleMinutes: 30, dailyRuns: 24, research: true });

  const saved = store.set({ autonomy: { enabled: true, idleMinutes: 9999, dailyRuns: -5, research: false } } as never);
  expect(saved.autonomy.enabled).toBe(true);
  expect(saved.autonomy.idleMinutes).toBe(240);
  expect(saved.autonomy.dailyRuns).toBe(0);
  expect(saved.autonomy.research).toBe(false);
});

it('a broken autonomy value falls back to the default', () => {
  const store = new SettingsStore(dir(), {});
  const saved = store.set({ autonomy: { idleMinutes: 'x' } } as never);
  expect(saved.autonomy.idleMinutes).toBe(30);
  expect(saved.autonomy.enabled).toBe(false);
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/settings.test.ts`
Expected: FAIL — `autonomy` missing.

- [ ] **Step 3: Implement**

Add `autonomy: AutonomySettings` to `Settings`; the values above to `DEFAULT_SETTINGS`. Add a partial-object rule to `sanitize` (each field validated separately, a missing field stays at its default, numbers `Math.round` + clamp). The "clamps invalid values" test in `settings.test.ts` must not break.

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/settings.ts test/settings.test.ts
git commit -m "feat(settings): autonomy settings (on/off, idle threshold, daily limit, research)"
```

---

### Task 2: Idle clock

**Files:**
- Create: `server/autonomy/activity.ts`
- Test: `test/activity.test.ts`

**Interfaces:**
- Consumes: nothing (pure class, clock injected).
- Produces: `class IdleClock { constructor(now: () => number); touch(): void; idleMs(): number; isIdle(minutes: number): boolean; wasIdle(minutes: number): boolean; }`
  - `touch()` pulls the last-activity time to now and sets the "returned from idle" flag.
  - If `wasIdle(minutes)` returns true, the flag is consumed **once** (the greeting does not repeat).

- [ ] **Step 1: Write the failing test**

```ts
// test/activity.test.ts
import { describe, it, expect } from 'vitest';
import { IdleClock } from '../server/autonomy/activity.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup() {
  let clock = NOON;
  const idle = new IdleClock(() => clock);
  return { idle, adv: (ms: number) => (clock += ms) };
}

describe('IdleClock', () => {
  it('a fresh clock is not idle', () => {
    const { idle } = setup();
    expect(idle.idleMs()).toBe(0);
    expect(idle.isIdle(30)).toBe(false);
  });

  it('becomes idle once the threshold is exceeded', () => {
    const { idle, adv } = setup();
    adv(31 * 60_000);
    expect(idle.isIdle(30)).toBe(true);
  });

  it('touch resets the idle counter', () => {
    const { idle, adv } = setup();
    adv(60 * 60_000);
    idle.touch();
    expect(idle.idleMs()).toBe(0);
    expect(idle.isIdle(30)).toBe(false);
  });

  it('the wasIdle flag is consumed once', () => {
    const { idle, adv } = setup();
    adv(45 * 60_000);
    expect(idle.wasIdle(30)).toBe(true);
    expect(idle.wasIdle(30)).toBe(false);
  });

  it('returning after a short break is not a greeting', () => {
    const { idle, adv } = setup();
    adv(5 * 60_000);
    idle.touch();
    expect(idle.wasIdle(30)).toBe(false);
  });

  it('never goes negative when the clock moves back', () => {
    const { idle, adv } = setup();
    adv(-60 * 60_000);
    expect(idle.idleMs()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/activity.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

A `lastAt` field; `idleMs()` = `Math.max(0, now() - lastAt)`; `touch()` sets `lastAt = now()` and, if `idleMs` (before touch) exceeded the threshold, sets `pendingGreet = true`. `wasIdle(minutes)` consumes `pendingGreet` and returns `true`. Threshold is `minutes * 60_000`.

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/activity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/autonomy/activity.ts test/activity.test.ts
git commit -m "feat(autonomy): idle clock (polling does not count)"
```

---

### Task 3: `web_search` tool + URL evidence gate

**Files:**
- Modify: `server/engine/tools/web.ts` (add `webSearchTool`)
- Modify: `server/engine/tools/index.ts` (add to `allTools`, export)
- Modify: `server/engine/permissions.ts` (`web_search` → `important`, network)
- Modify: `server/memory/distill.ts` (URL gate in `evidenceCheck`)
- Test: `test/web-search.test.ts`, `test/distill-url.test.ts`

**Interfaces:**
- Consumes: existing `Tool`, `truncate`, `evidenceCheck`, `DistillBlock`.
- Produces:
  - `export function webSearchTool(opts?: { fetchImpl?: typeof fetch }): Tool` — `name: 'web_search'`, `access: 'read'`, input `{ query: string, limit?: number }`.
  - In `classify()`: `req.tool === 'web_search'` → `{ class: 'important', reason: 'network' }`.
  - Extra `evidenceCheck` rule: if the note contains `https?://\S+`, every URL must appear verbatim in the cited event text; otherwise `reason: 'source url missing'`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/web-search.test.ts
import { describe, it, expect } from 'vitest';
import { webSearchTool } from '../server/engine/tools/web.js';
import { classify } from '../server/engine/permissions.js';

const ctx = { cwd: '.', signal: new AbortController().signal };

const html = `<div class="result"><a class="result__a" href="https://example.com/a">C++ AI acceleration</a>
<a class="result__snippet">On compiler optimization.</a></div>`;

const fetchOk = (body: string): typeof fetch =>
  (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;

describe('web_search', () => {
  it('is a network read but asks for approval', () => {
    const tool = webSearchTool();
    expect(tool.access).toBe('read');
    expect(classify({ tool: 'web_search', access: 'read', args: {}, cwd: '.' }).class).toBe('important');
  });

  it('returns results as title + url', async () => {
    const tool = webSearchTool({ fetchImpl: fetchOk(html) });
    const out = await tool.run({ query: 'c++ ai' }, ctx);
    expect(out.ok).toBe(true);
    expect(out.output).toContain('https://example.com/a');
    expect(out.output).toContain('C++ AI');
  });

  it('rejects an empty query', async () => {
    const out = await webSearchTool().run({ query: '   ' }, ctx);
    expect(out.ok).toBe(false);
  });

  it('does not invent on a network error, returns ok:false', async () => {
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const out = await webSearchTool({ fetchImpl: boom }).run({ query: 'x' }, ctx);
    expect(out.ok).toBe(false);
    expect(out.output).not.toContain('http');
  });

  it('ok:false when there are no results', async () => {
    const out = await webSearchTool({ fetchImpl: fetchOk('<html>empty</html>') }).run({ query: 'zzz' }, ctx);
    expect(out.ok).toBe(false);
  });
});
```

```ts
// test/distill-url.test.ts
import { describe, it, expect } from 'vitest';
import { evidenceCheck } from '../server/memory/distill.js';
import type { DistillBlock } from '../server/memory/distill.js';
import type { StoredEvent } from '../server/store/events.js';

function block(text: string): DistillBlock {
  const event = {
    id: 5, ts: 1, kind: 'tool_result', actor: 'system', sessionId: 's',
    payload: { tool: 'web_search', ok: true }, hash: 'h', prevHash: 'p', body: text,
  } as StoredEvent;
  return { sessionId: 's', events: [event], userText: '' };
}

const candidate = (text: string) => ({ kind: 'semantic' as const, text, concepts: [], evidence: [5], base: 0.4 });

describe('URL evidence gate', () => {
  it('accepts a URL that appears in the tool result', () => {
    const b = block('result: https://example.com/a on compiler acceleration');
    expect(evidenceCheck(candidate('compiler https://example.com/a acceleration'), b)).toBeNull();
  });

  it('rejects an invented URL', () => {
    const b = block('result: https://example.com/a on compiler acceleration');
    const out = evidenceCheck(candidate('compiler https://made-up.test/x acceleration'), b);
    expect(out?.reason).toBe('source url missing');
  });

  it('the old rule applies when there is no URL', () => {
    const b = block('the user likes turkish');
    expect(evidenceCheck(candidate('the user likes turkish'), b)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run test/web-search.test.ts test/distill-url.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`webSearchTool`: URL `https://html.duckduckgo.com/html/?q=<encodeURIComponent(query)>`, `AbortSignal.timeout(20_000)` + `ctx.signal` combined, body read up to `MAX_OUTPUT` (copy the existing `fetchUrlTool` pattern). Parsing: `result__a` links (`href` + text) and `result__snippet` if present. Each line is `- <title> — <url>`. If nothing matches, `{ ok: false, output: 'no results found' }`. Error → `{ ok: false, output: 'search failed: …' }`.

`permissions.classify`: early return for `web_search` (network), in the same place as `fetch_url`.

`distill.evidenceCheck`: **after** the existing checks, **before** the number check: `for (const url of candidate.text.match(/https?:\/\/\S+/g) ?? []) if (!rawSource.includes(url)) return { text: candidate.text, reason: 'source url missing' };`

`allTools`: add `webSearchTool()`; export it from `index.ts`.

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/web-search.test.ts test/distill-url.test.ts test/permissions.test.ts test/distill.test.ts`
Expected: PASS (including the existing distill tests)

- [ ] **Step 5: Commit**

```bash
git add server/engine/tools/web.ts server/engine/tools/index.ts server/engine/permissions.ts server/memory/distill.ts test/web-search.test.ts test/distill-url.test.ts
git commit -m "feat(engine): web_search tool and URL evidence gate"
```

---

### Task 4: Autonomous session + session-aware approver

**Files:**
- Modify: `server/sessions.ts` (`autonomous` flag, tool restriction, approval policy)
- Test: `test/autonomous-session.test.ts`

**Interfaces:**
- Consumes: `SessionManager`, `SessionDeps`, `classify`.
- Produces:
  - `SessionManager.create({ ..., autonomous?: boolean })`
  - **Not added** to `SessionInfo` (no separate list in the interface); the flag lives inside `Session`.
  - `SessionDeps.autonomy?: { research: boolean }` — determines the autonomous session's network permission.
  - A **pure** decision function in `server/engine/permissions.ts`:
    ```ts
    export type AutonomousVerdict = { allow: boolean; decision: 'auto-autonomous' | 'denied-autonomous' };
    /** The fate of a call that asks for approval in an autonomous session. Network tools depend on research permission. */
    export function autonomousVerdict(tool: string, research: boolean): AutonomousVerdict;
    ```
    `fetch_url` / `web_search` → `research ? {allow:true,'auto-autonomous'} : {allow:false,'denied-autonomous'}`; **every other tool** → `denied-autonomous` (safety net: even if unregistered).
  - Autonomous tool set: `readTools`, `webSearchTool`, `fetchUrlTool` (only with `autonomy.research`), `memoryTools`, `worldTools`, `loadSkillTool`. **Absent:** `writeTools`, `runCommandTool`, `computerTools`, `sessionTools`, `growthTools`, `feel`.
  - Approval policy: if the session is autonomous, `approver.ask` is **never called**; the `autonomousVerdict` result is written directly to the `permission` event and returned. The `waiting` state is not entered.

- [ ] **Step 1: Write the failing test**

```ts
// test/autonomous-session.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { SessionManager } from '../server/sessions.js';
import { autonomousVerdict } from '../server/engine/permissions.js';
import type { StreamRequest, Delta } from '../server/engine/types.js';
import type { Tool } from '../server/engine/tools/types.js';

function recording(script?: (req: StreamRequest) => Delta[]) {
  const requests: StreamRequest[] = [];
  return {
    requests,
    p: {
      name: 'rec',
      async *stream(req: StreamRequest) {
        requests.push(req);
        for (const d of script?.(req) ?? [{ type: 'text' as const, text: 'ok' }, { type: 'done' as const, stopReason: 'end' as const }]) yield d;
      },
    },
  };
}

function setup(opts: { research?: boolean; approve?: () => Promise<boolean> } = {}) {
  const log = new EventLog(':memory:');
  const rec = recording();
  let approveCalls = 0;
  const sessions = new SessionManager({
    provider: rec.p,
    model: 'm',
    log,
    autonomy: { research: opts.research ?? true },
    approve: async () => {
      approveCalls++;
      return opts.approve ? opts.approve() : true;
    },
    onEvent: () => undefined,
  });
  return { log, sessions, rec, approveCalls: () => approveCalls };
}

const names = (req: StreamRequest) => req.tools.map((t: { name: string }) => t.name);

describe('autonomous session', () => {
  it('write/exec tools are not registered', async () => {
    const { sessions, rec } = setup();
    const s = sessions.create({ role: 'worker', autonomous: true });
    await sessions.send(s.id, 'research');
    const tools = names(rec.requests[0]!);
    for (const banned of ['write_file', 'run_command', 'open_app', 'spawn_session', 'propose_change', 'feel']) {
      expect(tools).not.toContain(banned);
    }
    expect(tools).toContain('read_file');
    expect(tools).toContain('web_search');
  });

  it('network tools are not registered at all when research is off', async () => {
    const { sessions, rec } = setup({ research: false });
    const s = sessions.create({ role: 'worker', autonomous: true });
    await sessions.send(s.id, 'research');
    const tools = names(rec.requests[0]!);
    expect(tools).not.toContain('web_search');
    expect(tools).not.toContain('fetch_url');
  });

  it('a network call passes without waiting for approval', async () => {
    const log = new EventLog(':memory:');
    const rec = recording((req) =>
      req.messages.some((m) => m.role === 'tool')
        ? [{ type: 'text' as const, text: 'done' }, { type: 'done' as const, stopReason: 'end' as const }]
        : [
            { type: 'tool_call' as const, call: { id: 'c1', name: 'web_search', args: { query: 'x' } } },
            { type: 'done' as const, stopReason: 'tool_use' as const },
          ],
    );
    const sessions = new SessionManager({
      provider: rec.p,
      model: 'm',
      log,
      autonomy: { research: true },
      // Autonomous network reads must not ask for approval: if they do, this throws and the test fails.
      approve: async () => {
        throw new Error('must not ask');
      },
      onEvent: () => undefined,
    });
    const s = sessions.create({ role: 'worker', autonomous: true });
    const result = await sessions.send(s.id, 'research');
    expect(result.ok).toBe(true);
    expect(log.read().some((e) => e.kind === 'permission' && e.payload['decision'] === 'auto-autonomous')).toBe(true);
  });

  it('a non-network approval request is rejected instantly (pure decision)', () => {
    expect(autonomousVerdict('run_command', true)).toEqual({ allow: false, decision: 'denied-autonomous' });
    expect(autonomousVerdict('write_file', true)).toEqual({ allow: false, decision: 'denied-autonomous' });
  });

  it('a network tool depends on research permission', () => {
    expect(autonomousVerdict('web_search', true)).toEqual({ allow: true, decision: 'auto-autonomous' });
    expect(autonomousVerdict('fetch_url', true)).toEqual({ allow: true, decision: 'auto-autonomous' });
    expect(autonomousVerdict('web_search', false)).toEqual({ allow: false, decision: 'denied-autonomous' });
  });

  it('an autonomous turn never lands in the waiting state', async () => {
    const log = new EventLog(':memory:');
    const rec = recording((req) =>
      req.messages.some((m) => m.role === 'tool')
        ? [{ type: 'text' as const, text: 'okay' }, { type: 'done' as const, stopReason: 'end' as const }]
        : [
            { type: 'tool_call' as const, call: { id: 'c1', name: 'fetch_url', args: { url: 'https://example.com' } } },
            { type: 'done' as const, stopReason: 'tool_use' as const },
          ],
    );
    const statuses: string[] = [];
    const sessions = new SessionManager({
      provider: rec.p,
      model: 'm',
      log,
      autonomy: { research: true },
      approve: async () => {
        throw new Error('must not ask');
      },
      onEvent: (e) => {
        if (e.type === 'status') statuses.push(e.status);
      },
    });
    const s = sessions.create({ role: 'worker', autonomous: true });
    const result = await sessions.send(s.id, 'research');
    expect(result.ok).toBe(true);
    expect(statuses).not.toContain('waiting');
  });

  it('a normal session is unaffected', async () => {
    const { sessions, rec } = setup();
    const s = sessions.create({ role: 'worker' });
    await sessions.send(s.id, 'hi');
    const tools = names(rec.requests[0]!);
    expect(tools).toContain('write_file');
    expect(tools).toContain('run_command');
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/autonomous-session.test.ts`
Expected: FAIL — `autonomous` unknown.

- [ ] **Step 3: Implement**

Add `autonomous: boolean` to the `Session` type. `create()` takes `opts.autonomous === true`; it writes `autonomous: true` into the `session_start` payload (sleep will use it). `runTurn` splits the tool list in two: the restricted set if autonomous, the existing set otherwise.

Approval: add `autonomousVerdict` (pure) to `permissions.ts`. In the approver inside `runTurn`, if `session.autonomous`, `ask` is **not called**; the result of `autonomousVerdict(call.name, deps.autonomy?.research === true)` is written to the `permission` event (`decision`) and used as `allowed`. The `isWorker` → `waiting` branch does not run in autonomous mode.

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/autonomous-session.test.ts test/sessions.test.ts test/session-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/sessions.ts server/engine/permissions.ts test/autonomous-session.test.ts
git commit -m "feat(sessions): autonomous session and session-aware approval policy"
```

---

### Task 5: Sleep skips autonomous sessions

**Files:**
- Modify: `server/memory/sleep.ts`
- Test: `test/sleep-autonomous.test.ts`

**Interfaces:**
- Consumes: `EventLog`, `sleep()`, `readCheckpoints`.
- Produces: `sleep()` **does not process** the events of autonomous sessions but advances the checkpoint (`skippedAutonomous: string[]` report field).

- [ ] **Step 1: Write the failing test**

```ts
// test/sleep-autonomous.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { sleep, readCheckpoints } from '../server/memory/sleep.js';

describe('sleep and autonomous sessions', () => {
  it('does not distill an autonomous session, advances the checkpoint', async () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    log.append('session_start', 'brain', 'auto-1', { cwd: 'C:\\p', role: 'worker', autonomous: true });
    log.append('message', 'user', 'auto-1', { role: 'user' }, 'self-directed research was run');
    log.append('message', 'session', 'auto-1', { role: 'assistant' }, 'found: one library');

    const report = await sleep(log, memory, { now: Date.now() });
    expect(report.skippedAutonomous).toContain('auto-1');
    expect(memory.list({ includeDormant: true })).toHaveLength(0);
    expect(readCheckpoints(log).get('auto-1')).toBeGreaterThan(0);
  });

  it('a normal session is still distilled', async () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    log.append('session_start', 'user', 's1', { cwd: 'C:\\p', role: 'worker' });
    log.append('message', 'user', 's1', { role: 'user' }, 'the user wants short answers');
    const report = await sleep(log, memory, { now: Date.now() });
    expect(report.sessionsProcessed).toBe(1);
    expect(report.skippedAutonomous ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/sleep-autonomous.test.ts`
Expected: FAIL — `skippedAutonomous` missing / session is being distilled.

- [ ] **Step 3: Implement**

Inside the session loop in `sleep()`: if the `session_start` payload has `autonomous === true`, write a `sleep_run` event with `step: 'session_done'`, `notes: 0` (the checkpoint advances) and `skippedAutonomous.push(sessionId)`; then `continue`. Add `skippedAutonomous: string[]` to `SleepReport` (default `[]`).

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/sleep-autonomous.test.ts test/sleep.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/memory/sleep.ts test/sleep-autonomous.test.ts
git commit -m "feat(memory): sleep skips autonomous sessions (no feedback)"
```

---

### Task 6: Persistent inbox projection

**Files:**
- Create: `server/autonomy/inbox.ts`
- Modify: `server/store/events.ts` (`EventKind` += `'dmn_run' | 'inbox_note'`)
- Test: `test/inbox.test.ts`

**Interfaces:**
- Consumes: `EventLog`.
- Produces:
  ```ts
  export type InboxKind = 'research' | 'suggestion' | 'warning' | 'shadow';
  export type InboxItem = { id: number; at: number; kind: InboxKind; text: string; refs: string[]; read: boolean };
  export class InboxStore {
    constructor(log: EventLog, now?: () => number);
    add(item: { kind: InboxKind; text: string; refs?: string[] }): InboxItem | null; // 24h dedupe → null
    list(opts?: { unreadOnly?: boolean; limit?: number }): InboxItem[];
    markRead(id: number): boolean;
    unreadCount(): number;
    rebuild(): void;
  }
  ```
  - Dedupe: if the same `kind` + same `text` exists in the last 24 hours, nothing is written.
  - Text is collapsed to a single line, `≤ 300` characters.
  - The projection is built from `inbox_note` events; the `read` state is not kept **in a separate table** instead of `inbox_read`, nor via an event (`inbox_note` + `payload.read = true`) — the read mark must be persistent and rebuildable: `inbox_read` is **not** a new `EventKind`, but a second event carrying `read: true` in the `inbox_note` payload.

- [ ] **Step 1: Write the failing test**

```ts
// test/inbox.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { InboxStore } from '../server/autonomy/inbox.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup() {
  let clock = NOON;
  const log = new EventLog(':memory:');
  const inbox = new InboxStore(log, () => clock);
  return { log, inbox, adv: (ms: number) => (clock += ms) };
}

describe('InboxStore', () => {
  it('adds and lists lines', () => {
    const { inbox } = setup();
    inbox.add({ kind: 'research', text: 'C++ compiler article', refs: ['n1'] });
    const items = inbox.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe('C++ compiler article');
    expect(items[0]!.read).toBe(false);
  });

  it('does not write the same line twice within 24 hours', () => {
    const { inbox, adv } = setup();
    inbox.add({ kind: 'research', text: 'same' });
    expect(inbox.add({ kind: 'research', text: 'same' })).toBeNull();
    adv(23 * 60 * 60_000);
    expect(inbox.add({ kind: 'research', text: 'same' })).toBeNull();
    adv(2 * 60 * 60_000);
    expect(inbox.add({ kind: 'research', text: 'same' })).not.toBeNull();
  });

  it('collapses text to one line and truncates', () => {
    const { inbox } = setup();
    const item = inbox.add({ kind: 'warning', text: `a\n\nb   ${'x'.repeat(400)}` })!;
    expect(item.text).not.toContain('\n');
    expect(item.text.length).toBeLessThanOrEqual(300);
  });

  it('the read mark is persistent and rebuildable', () => {
    const { inbox } = setup();
    const item = inbox.add({ kind: 'research', text: 'to be read' })!;
    expect(inbox.markRead(item.id)).toBe(true);
    expect(inbox.unreadCount()).toBe(0);
    inbox.rebuild();
    expect(inbox.unreadCount()).toBe(0);
  });

  it('rebuild preserves the lines', () => {
    const { inbox } = setup();
    inbox.add({ kind: 'research', text: 'one' });
    inbox.add({ kind: 'suggestion', text: 'two' });
    inbox.rebuild();
    expect(inbox.list()).toHaveLength(2);
  });

  it('unreadOnly and limit', () => {
    const { inbox } = setup();
    inbox.add({ kind: 'research', text: 'one' });
    const second = inbox.add({ kind: 'research', text: 'two' })!;
    inbox.markRead(second.id);
    expect(inbox.list({ unreadOnly: true })).toHaveLength(1);
    expect(inbox.list({ limit: 1 })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/inbox.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`EventKind` += `'dmn_run' | 'inbox_note'`. Schema:
```sql
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  refs TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
```
`add()`: normalize (squeeze whitespace, `\n` → space, truncate at 300) → dedupe query (`kind = ? AND text = ? AND at > now-24h`) → write the event → add to the projection. `markRead()`: writes an `inbox_note` event with `{ inboxId, read: true }` + updates the row. `rebuild()`: `DELETE FROM inbox`, replay events in order (mark read if `payload.inboxId` is present, otherwise add the row).

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/inbox.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/autonomy/inbox.ts server/store/events.ts test/inbox.test.ts
git commit -m "feat(autonomy): persistent inbox projection (24h dedupe)"
```

---

### Task 7: DMN scheduler, drives and greeting

**Files:**
- Create: `server/autonomy/dmn.ts`
- Create: `server/autonomy/drives.ts`
- Test: `test/dmn.test.ts`, `test/drives.test.ts`

**Interfaces:**
- Consumes: `IdleClock`, `InboxStore`, `SessionManager`, `AutonomySettings`, `MemoryStore`, `WorldModel`.
- Produces:
  ```ts
  // drives.ts
  export type DriveName = 'integrity' | 'curiosity' | 'style';
  export type Drive = { name: DriveName; score: number; prompt: string };
  export function selectDrive(input: {
    logOk: boolean;
    unknownTerms: string[];
    styleSignals: string[];
    lastDrive: DriveName | null;
    repeats: number;
  }): Drive | null;

  /**
   * Input for the curiosity drive: technical-looking terms that appear in user
   * messages and have no counterpart in memory. Deterministic; no model call.
   */
  export function unknownTermsFrom(input: {
    userMessages: string[];
    knownText: string;
    limit?: number;
  }): string[];

  // dmn.ts
  export type DmnDeps = {
    sessions: SessionManager;
    inbox: InboxStore;
    idle: IdleClock;
    memory: MemoryStore;
    /** Same bridge as sleep; without it only a deterministic episodic summary is written. */
    distiller?: Distiller;
    settings: () => { enabled: boolean; idleMinutes: number; dailyRuns: number; research: boolean };
    now?: () => number;
    cwd: string;
    lastDrive?: DriveName | null;
    buildDriveInput: () => { logOk: boolean; unknownTerms: string[]; styleSignals: string[] };
  };
  export class Dmn {
    constructor(deps: DmnDeps);
    /** One turn attempt. If conditions do not hold, {ran:false, reason}. */
    tick(now: number): { ran: boolean; reason?: string; sessionId?: string };
    start(intervalMs?: number): void;   // setInterval → tick(Date.now())
    stop(): void;                        // idempotent
    stats(): { runsToday: number; lastRunAt: number | null };
  }
  ```
  - Conditions (all): `settings().enabled`, `idle.isIdle(idleMinutes)`, no running/waiting session (check happens **before opening a session**), `now - lastRunAt >= 10 min`, `runsToday < dailyRuns`, a drive exists.
  - Turn: select a drive → open an autonomous session (`title: 'autonomous'`) → `await sessions.send` → **distill that session's events in the same turn with `distill()`** (with `memory`, `distiller`, `project`) → the first 300 characters of the output become the inbox line → `dmn_run` event.
  - Distillation treats `web_search`/`fetch_url` tool results as evidence; the URL gate rejects invented sources. Notes are written **before** the morning report.
  - Because `sleep()` skips these sessions (Task 5), their own output is not distilled again the next night.
  - `runsToday` is counted by the local day of `now`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/drives.test.ts
import { describe, it, expect } from 'vitest';
import { selectDrive, unknownTermsFrom } from '../server/autonomy/drives.js';

const base = { logOk: true, unknownTerms: [], styleSignals: [], lastDrive: null, repeats: 0 };

describe('selectDrive', () => {
  it('an integrity drive takes priority when the log is broken', () => {
    const d = selectDrive({ ...base, logOk: false, unknownTerms: ['a', 'b', 'c'], styleSignals: ['x'] });
    expect(d?.name).toBe('integrity');
  });

  it('curiosity when there is an unknown term', () => {
    expect(selectDrive({ ...base, unknownTerms: ['riscv'] })?.name).toBe('curiosity');
  });

  it('style when there is a repeated style signal', () => {
    expect(selectDrive({ ...base, styleSignals: ['short answer'] })?.name).toBe('style');
  });

  it('no drive when there is no signal', () => {
    expect(selectDrive(base)).toBeNull();
  });

  it('the same drive is not selected 3 times in a row', () => {
    const d = selectDrive({ ...base, unknownTerms: ['x'], lastDrive: 'curiosity', repeats: 3 });
    expect(d?.name).not.toBe('curiosity');
  });

  it('every drive has a prompt text', () => {
    const d = selectDrive({ ...base, unknownTerms: ['x'] });
    expect(d!.prompt.length).toBeGreaterThan(20);
  });
});

describe('unknownTermsFrom', () => {
  it('finds a technical term that is not in memory', () => {
    const terms = unknownTermsFrom({
      userMessages: ['I am working on riscv, also tried vLLM'],
      knownText: 'the user likes turkish',
    });
    expect(terms).toContain('riscv');
  });

  it('skips a term that appears in memory', () => {
    const terms = unknownTermsFrom({ userMessages: ['riscv is good'], knownText: 'there is a note on riscv' });
    expect(terms).toEqual([]);
  });

  it('does not count plain turkish words as terms', () => {
    const terms = unknownTermsFrom({ userMessages: ['the weather is nice today and things are good'], knownText: '' });
    expect(terms).toEqual([]);
  });

  it('applies the limit and deduplicates', () => {
    const terms = unknownTermsFrom({
      userMessages: ['riscv riscv riscv vllm tensorrt onnx'],
      knownText: '',
      limit: 2,
    });
    expect(terms).toHaveLength(2);
    expect(new Set(terms).size).toBe(2);
  });
});
```

```ts
// test/dmn.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { InboxStore } from '../server/autonomy/inbox.js';
import { IdleClock } from '../server/autonomy/activity.js';
import { Dmn } from '../server/autonomy/dmn.js';
import { SessionManager } from '../server/sessions.js';
import { MemoryStore } from '../server/memory/notes.js';
import type { StreamRequest } from '../server/engine/types.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup(over: { enabled?: boolean; dailyRuns?: number; research?: boolean } = {}) {
  let clock = NOON;
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  const inbox = new InboxStore(log, () => clock);
  const idle = new IdleClock(() => clock);
  const requests: StreamRequest[] = [];
  const sessions = new SessionManager({
    provider: {
      name: 'rec',
      async *stream(req: StreamRequest) {
        requests.push(req);
        yield { type: 'text' as const, text: 'RISC-V article found: https://example.com/rv' };
        yield { type: 'done' as const, stopReason: 'end' as const };
      },
    },
    model: 'm',
    log,
    autonomy: { research: over.research ?? true },
    approve: async () => false,
    onEvent: () => undefined,
  });
  const dmn = new Dmn({
    sessions,
    inbox,
    idle,
    memory,
    cwd: 'C:\\project',
    now: () => clock,
    settings: () => ({
      enabled: over.enabled ?? true,
      idleMinutes: 30,
      dailyRuns: over.dailyRuns ?? 24,
      research: over.research ?? true,
    }),
    buildDriveInput: () => ({ logOk: true, unknownTerms: ['riscv'], styleSignals: [] }),
  });
  return { log, memory, inbox, idle, dmn, sessions, requests, adv: (ms: number) => (clock += ms), clock: () => clock };
}

describe('Dmn', () => {
  it('does not run when the setting is off', () => {
    const { dmn } = setup({ enabled: false });
    expect(dmn.tick(NOON).ran).toBe(false);
  });

  it('does not run while the user is active', () => {
    const { dmn } = setup();
    expect(dmn.tick(NOON).reason).toBe('user active');
  });

  it('opens an autonomous turn and writes to the inbox when idle + a drive exists', async () => {
    const { dmn, adv, inbox, log } = setup();
    adv(31 * 60_000);
    const result = dmn.tick(NOON + 31 * 60_000);
    expect(result.ran).toBe(true);
    await vi.waitFor(() => expect(inbox.list()).toHaveLength(1));
    expect(inbox.list()[0]!.kind).toBe('research');
    expect(log.read().some((e) => e.kind === 'dmn_run')).toBe(true);
  });

  it('applies a 10-minute cooldown', async () => {
    const { dmn, adv } = setup();
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(true);
    adv(5 * 60_000);
    expect(dmn.tick(NOON + 36 * 60_000).ran).toBe(false);
  });

  it('does not exceed the daily limit', () => {
    const { dmn, adv } = setup({ dailyRuns: 0 });
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).reason).toBe('daily limit');
  });

  it('tick does not run after stop', () => {
    const { dmn, adv } = setup();
    dmn.start(60_000);
    dmn.stop();
    dmn.stop();
    adv(31 * 60_000);
    expect(dmn.tick(NOON + 31 * 60_000).ran).toBe(false);
  });

  it('does not request network tools when research is off', async () => {
    const { dmn, adv, requests } = setup({ research: false });
    adv(31 * 60_000);
    dmn.tick(NOON + 31 * 60_000);
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    const tools = requests[0]!.tools.map((t: { name: string }) => t.name);
    expect(tools).not.toContain('web_search');
  });

  it('distills within the turn: the note is written before the morning report', async () => {
    // The distiller returns a candidate that cites the URL in the tool result.
    let clock = NOON;
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    const inbox = new InboxStore(log, () => clock);
    const idle = new IdleClock(() => clock);
    const sessions = new SessionManager({
      provider: {
        name: 'rec',
        async *stream(req) {
          if (!req.messages.some((m) => m.role === 'tool')) {
            yield { type: 'tool_call' as const, call: { id: 'c1', name: 'web_search', args: { query: 'riscv' } } };
            yield { type: 'done' as const, stopReason: 'tool_use' as const };
            return;
          }
          yield { type: 'text' as const, text: 'RISC-V compiler note: https://example.com/rv' };
          yield { type: 'done' as const, stopReason: 'end' as const };
        },
      },
      model: 'm',
      log,
      autonomy: { research: true },
      approve: async () => false,
      onEvent: () => undefined,
    });
    const dmn = new Dmn({
      sessions,
      inbox,
      idle,
      memory,
      cwd: 'C:\\project',
      now: () => clock,
      // A single candidate: it cites the tool result event as evidence.
      distiller: async () => {
        const toolEvent = log.read().find((e) => e.kind === 'tool_result');
        return JSON.stringify([
          {
            kind: 'semantic',
            text: 'RISC-V compiler optimization https://example.com/rv is useful',
            concepts: ['riscv'],
            evidence: [toolEvent?.id ?? 1],
            importance: 0.5,
          },
        ]);
      },
      settings: () => ({ enabled: true, idleMinutes: 30, dailyRuns: 24, research: true }),
      buildDriveInput: () => ({ logOk: true, unknownTerms: ['riscv'], styleSignals: [] }),
    });

    clock = NOON + 31 * 60_000;
    expect(dmn.tick(clock).ran).toBe(true);
    // The note must be in memory before the inbox line is written (same-turn distillation).
    await vi.waitFor(() => expect(memory.list({ includeDormant: true }).length).toBeGreaterThan(0));
    expect(memory.list()[0]!.text).toContain('https://example.com/rv');
    expect(inbox.list()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run test/drives.test.ts test/dmn.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`drives.ts`: scoring — `integrity` is 1.0 if `logOk === false`; `curiosity` is `0.6 + min(0.3, 0.1*length)` if `unknownTerms.length > 0`; `style` is 0.5 if `styleSignals.length > 0`. If `lastDrive === name && repeats >= 3`, that drive's score drops to 0. The highest score, greater than 0. Prompt texts are Turkish single-sentence task sentences.

`unknownTermsFrom`: lowercase the text, take `[a-z0-9+#.]{3,}` pieces, drop: those that look like only letters and a Turkish dictionary word (`/^[a-zçğıöşü]+$/` and length ≤ 6 → count as an everyday word), those that appear in `knownText`, the first 200 characters. The "technical-looking" criterion is deterministic: contains a digit OR contains `+`/`#`/`.` OR length ≥ 7. Deduplicate, apply `limit` (default 5).

`dmn.ts`: the conditions above; `runsToday` is the local-day count of `dmn_run` events. In a turn: `sessions.create({ role: 'worker', autonomous: true, title: 'autonomous', cwd })` + `await sessions.send(id, drive.prompt)`.

**Distillation in the same turn (spec §8.2):** when the turn ends, get that session's events with `log.read(sessionId)` and call `distill(deps.memory, events, { project: projectKey(cwd), ...(deps.distiller ? { distiller: deps.distiller } : {}) })`. Notes are written here — **before** the inbox line. A distillation error does not fail the turn: `try/catch`, the error is written into the `dmn_run` payload as `distillError`.

Then take the last assistant text from `sessions.history(id)`, truncate to 300, write it to the inbox as `research` (curiosity) / `suggestion` (style) / `warning` (integrity) (`refs: [sessionId]`), and write the `dmn_run` event (`drive`, `notes`, `inboxId`). Inside `tick`, if `sessions.canStartBackground()` is false, return `'background limit'`.

`start(intervalMs = 60_000)`: `this.timer = setInterval(() => this.tick(Date.now()), intervalMs)`. `stop()`: `clearInterval`, `this.stopped = true`, `timer = null`. If `stopped`, `tick` returns `{ ran:false, reason:'stopped' }`.

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/drives.test.ts test/dmn.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/autonomy/dmn.ts server/autonomy/drives.ts test/dmn.test.ts test/drives.test.ts
git commit -m "feat(autonomy): DMN scheduler, three drives and inbox report"
```

---

### Task 8: Shadow mode (repo readiness estimate)

**Files:**
- Create: `server/autonomy/shadow.ts`
- Modify: `server/sessions.ts` (`onSessionStart` hook)
- Test: `test/shadow.test.ts`

**Interfaces:**
- Consumes: `MemoryStore` (past notes), file system.
- Produces:
  ```ts
  export type ShadowReport = { repo: string; found: string[]; missing: string[]; line: string };
  /** Read-only: inspects manifests, runs no commands, installs nothing. */
  export function shadowReport(input: { repoPath: string; known: string[]; readFile?: (p: string) => string | null }): ShadowReport;

  /** Extracts "required in this repo" tags from project notes in memory (deterministic). */
  export function knownRequirements(memory: MemoryStore, repoPath: string): string[];
  ```
  - `SessionDeps.onSessionStart?: (info: { id: string; cwd: string; autonomous: boolean }) => void` — called **once** inside `create()`, after the session is recorded.
  - Manifests: `package.json`, `Cargo.toml`, `go.mod`, `requirements.txt`, `*.csproj` (if present).
  - `known`: tags coming from memory (`concepts` + tool names in the text: node/npm/rust/cargo/go/python/dotnet).
  - `missing`: known requirements with no trace in the manifest.
  - `line`: a single-line English summary (≤ 300).

- [ ] **Step 1: Write the failing test**

```ts
// test/shadow.test.ts
import { describe, it, expect } from 'vitest';
import { shadowReport, knownRequirements } from '../server/autonomy/shadow.js';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';

const files = (map: Record<string, string>) => (p: string) => map[p] ?? null;

describe('shadowReport', () => {
  it('treats the node compiler as ready when package.json is present', () => {
    const r = shadowReport({
      repoPath: 'C:\\p',
      known: ['node', 'dotnet'],
      readFile: files({ 'package.json': '{"name":"x"}' }),
    });
    expect(r.found).toContain('node');
    expect(r.missing).toContain('dotnet');
  });

  it('everything is missing when there is no manifest', () => {
    const r = shadowReport({ repoPath: 'C:\\p', known: ['node'], readFile: files({}) });
    expect(r.missing).toEqual(['node']);
  });

  it('produces a single-line summary and truncates', () => {
    const r = shadowReport({
      repoPath: 'C:\\p',
      known: Array.from({ length: 40 }, (_, i) => `requirement-${i}`),
      readFile: files({}),
    });
    expect(r.line).not.toContain('\n');
    expect(r.line.length).toBeLessThanOrEqual(300);
    expect(r.line).toContain('missing');
  });

  it('clean line when nothing is missing', () => {
    const r = shadowReport({ repoPath: 'C:\\p', known: ['node'], readFile: files({ 'package.json': '{}' }) });
    expect(r.line).toContain('ready');
  });

  it('a broken manifest does not crash', () => {
    expect(() => shadowReport({ repoPath: 'C:\\p', known: ['node'], readFile: files({ 'package.json': '{{{' }) }).not.toThrow();
  });
});

describe('onSessionStart', () => {
  it('called once when the session opens', () => {
    const seen: { cwd: string; autonomous: boolean }[] = [];
    const sessions = new SessionManager({
      provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
      model: 'm',
      log: new EventLog(':memory:'),
      approve: async () => true,
      onSessionStart: (info) => seen.push({ cwd: info.cwd, autonomous: info.autonomous }),
      onEvent: () => undefined,
    });
    sessions.create({ role: 'worker', cwd: 'C:\\repo' });
    sessions.create({ role: 'worker', cwd: 'C:\\repo', autonomous: true });
    expect(seen).toEqual([
      { cwd: 'C:\\repo', autonomous: false },
      { cwd: 'C:\\repo', autonomous: true },
    ]);
  });
});

describe('knownRequirements', () => {
  it('collects tool names from project notes', () => {
    const log = new EventLog(':memory:');
    const memory = new MemoryStore(log);
    memory.add({ kind: 'semantic', text: 'this repo needs node and dotnet', concepts: ['dotnet'], evidence: [1], base: 0.6, project: 'repo' });
    const known = knownRequirements(memory, 'repo');
    expect(known).toContain('dotnet');
    expect(known).toContain('node');
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/shadow.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`server/autonomy/shadow.ts`: `shadowReport` — mapping table: `package.json` → `node`/`npm`; `Cargo.toml` → `rust`/`cargo`; `go.mod` → `go`; `requirements.txt` → `python`; `*.csproj` → `dotnet`. `known` tags are lowercased and matched against these keys. If the manifest content is JSON, `JSON.parse` is attempted and errors are swallowed. If `readFile` is not given, `readFileSync(join(repoPath, name), 'utf8')`, `null` if the file is missing. **No command is run, no file is written.**

`knownRequirements(memory, repoPath)`: the `concepts` of that project's notes + tool names appearing in the text; deduplicate with a `Set`, at most 8.

`server/sessions.ts`: add `SessionDeps.onSessionStart?` and call it inside `create()` after the `session_start` event (`{ id, cwd, autonomous }`).

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run test/shadow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/autonomy/shadow.ts server/sessions.ts test/shadow.test.ts
git commit -m "feat(autonomy): shadow mode repo readiness estimate (read-only)"
```

---

### Task 9: API, dashboard and interface (inbox + autonomy)

**Files:**
- Modify: `server/http/server.ts` (`GET /api/inbox`, `POST /api/inbox/:id/read`, activity hook)
- Modify: `server/dashboard.ts` (`unreadInbox`)
- Modify: `server/serve.ts` (set up Autonomy, hook it in, stop it in `close()`)
- Create: `app/src/components/Inbox.tsx`
- Modify: `app/src/App.tsx`, `app/src/components/CommandCenter.tsx`, `app/src/components/Settings.tsx`, `app/src/command.css`
- Test: `test/http-inbox.test.ts`

**Interfaces:**
- Consumes: `InboxStore` (Task 6), `Dmn` (Task 7), `IdleClock` (Task 2), settings (Task 1).
- Produces:
  - `ZeroServerOptions.inbox?: { list: (o?: { unreadOnly?: boolean; limit?: number }) => InboxItem[]; markRead: (id: number) => boolean; unreadCount: () => number }`
  - `GET /api/inbox` → `{ items, unread }`; `POST /api/inbox/:id/read` → `{ ok }`
  - `DashboardData.unreadInbox?: number`
  - `RunningServer.autonomy: { touch(): void; stop(): void; stats(): { runsToday: number; lastRunAt: number | null } }`

- [ ] **Step 1: Write the failing test**

```ts
// test/http-inbox.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZeroServer, type EventHub, type ZeroServer } from '../server/http/server.js';
import { ApprovalBroker } from '../server/http/approvals.js';
import { RepoStore } from '../server/repos.js';
import { SessionManager } from '../server/sessions.js';
import { FakeProvider } from '../server/engine/providers/fake.js';
import { EventLog } from '../server/store/events.js';
import { InboxStore } from '../server/autonomy/inbox.js';

const TOKEN = 't';
const servers: ZeroServer[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'karen-inbox-'));
  const log = new EventLog(':memory:');
  const inbox = new InboxStore(log);
  inbox.add({ kind: 'research', text: 'RISC-V article' });
  const hub: EventHub = { send: () => undefined };
  const sessions = new SessionManager({
    provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
    model: 'm', log, approve: async () => true, onEvent: (e) => hub.send(e),
  });
  const server = createZeroServer({
    repos: new RepoStore(join(dir, 'repos.json')), sessions,
    approvals: new ApprovalBroker(), hub, token: TOKEN, rootDir: dir,
    inbox: { list: (o) => inbox.list(o), markRead: (id) => inbox.markRead(id), unreadCount: () => inbox.unreadCount() },
  });
  servers.push(server);
  return { server, inbox };
}

describe('/api/inbox', () => {
  it('requires a token', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    expect((await fetch(`http://127.0.0.1:${port}/api/inbox`)).status).toBe(401);
  });

  it('returns the lines and the unread count', async () => {
    const { server } = setup();
    const { port } = await server.listen(0);
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/inbox?token=${TOKEN}`)).json()) as {
      items: { id: number; text: string }[]; unread: number;
    };
    expect(body.items).toHaveLength(1);
    expect(body.unread).toBe(1);
  });

  it('marks as read', async () => {
    const { server, inbox } = setup();
    const { port } = await server.listen(0);
    const id = inbox.list()[0]!.id;
    const res = await fetch(`http://127.0.0.1:${port}/api/inbox/${id}/read?token=${TOKEN}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(inbox.unreadCount()).toBe(0);
  });

  it('404 when there is no inbox', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-inbox-off-'));
    const hub: EventHub = { send: () => undefined };
    const sessions = new SessionManager({
      provider: new FakeProvider([[{ type: 'done', stopReason: 'end' }]]),
      model: 'm', log: new EventLog(':memory:'), approve: async () => true, onEvent: (e) => hub.send(e),
    });
    const server = createZeroServer({
      repos: new RepoStore(join(dir, 'r.json')), sessions, approvals: new ApprovalBroker(),
      hub, token: TOKEN, rootDir: dir,
    });
    servers.push(server);
    const { port } = await server.listen(0);
    expect((await fetch(`http://127.0.0.1:${port}/api/inbox?token=${TOKEN}`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run test/http-inbox.test.ts`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

`http/server.ts`: `inbox` is optional; `GET /api/inbox` → `{ items: list(), unread: unreadCount() }`; `POST /api/inbox/:id/read` → `markRead` result 200/404. Activity hook: at the top of `handleApi`, if `req.method !== 'GET'`, `opts.onActivity?.()`. **GET does not count** (dashboard/state polling must not kill the DMN). `serve.ts`: set up `IdleClock`, `InboxStore`, `Dmn`. `buildDriveInput` is fed from real sources:

```ts
buildDriveInput: () => {
  const since = Date.now() - 7 * 86_400_000;
  const userMessages = log.read().filter((e) => e.kind === 'message' && e.payload['role'] === 'user' && e.ts >= since).map((e) => e.body ?? '');
  const knownText = memory.list({ includeDormant: true }).flatMap((n) => [n.text, ...n.concepts]).join(' ');
  return { logOk: log.verify().ok, unknownTerms: unknownTermsFrom({ userMessages, knownText }), styleSignals: [] };
}
```

`styleSignals` is empty in Phase 2 — the style drive will be fed by the repeat counter in Phase 4 (noted in the README).

`onActivity` → `idle.touch()`, then the greeting check; `dmn.start()`; `dmn.stop()` inside `close()` (before whisper.stop).

**Shadow mode wiring (so it is not orphaned):** `SessionManager` is given `onSessionStart`:

```ts
onSessionStart: ({ cwd }) => {
  const known = knownRequirements(memory, projectKey(cwd));
  if (known.length === 0) return;
  const report = shadowReport({ repoPath: cwd, known });
  inbox.add({ kind: 'shadow', text: report.line, refs: [projectKey(cwd)] });
}
```

The inbox's 24-hour dedupe stops the same repo from being written over and over. Shadow mode **runs no commands and installs nothing** — it only reads manifests and leaves a single line. Greeting: inside `onActivity`, if `idle.wasIdle(idleMinutes)` is true and `inbox.unreadCount() > 0`, send **one** `notify` to the brain session — text of the form `N notes and M suggestions piled up while you were away.`

`DashboardData.unreadInbox?: number` (optional, when `input.unreadInbox` is given).

Interface: `Inbox.tsx` — `GET /api/inbox` every 8 s; a line list (kind tag + text + time + "read" button); if empty, `No autonomous notes.`; the unread count in the `.cc-feed-panel` heading in `CommandCenter`; an "Autonomy" group in `Settings` (on/off, idle threshold number, daily limit, research permission) using the existing `save({ autonomy: {...} })` pattern.

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx vitest run test/http-inbox.test.ts test/dashboard.test.ts`
Expected: PASS

- [ ] **Step 5: Build**

Run: `npx tsc --noEmit && npm run app:build`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add server/http/server.ts server/dashboard.ts server/serve.ts app/src test/http-inbox.test.ts
git commit -m "feat(autonomy): inbox API, dashboard badge and interface"
```

---

### Task 10: Version 1.3.0 and end-to-end verification

**Files:**
- Modify: `package.json` (`version: 1.3.0`)
- Modify: `CHANGELOG.md`
- Modify: `README.md`, `site/index.html` (Phase 2 features)

- [ ] **Step 1: Version + changelog + announcement**

`1.3.0`; add DMN, three drives, `web_search`, URL evidence gate, inbox, shadow mode, autonomy settings to the changelog. Add a "Learns while you are away" card to the site; a DMN row to the README feature table.

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: clean + all tests PASS

- [ ] **Step 3: Live verification (autonomy triggered manually)**

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;" + $env:Path
$d = Join-Path $env:TEMP "karen-v13"
Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
  -ArgumentList "node_modules/tsx/dist/cli.mjs","server/cli.ts","serve","--port","7464","--data",$d `
  -RedirectStandardOutput "$env:TEMP\v13.log" -RedirectStandardError "$env:TEMP\v13e.log" -WindowStyle Hidden
Start-Sleep -Seconds 9
$tok = [regex]::Match((Get-Content "$env:TEMP\v13.log" -Raw), 'token=([a-f0-9]+)').Groups[1].Value
$a = Invoke-RestMethod "http://127.0.0.1:7464/api/settings?token=$tok"
"autonomy: enabled=$($a.autonomy.enabled) idle=$($a.autonomy.idleMinutes) daily=$($a.autonomy.dailyRuns) research=$($a.autonomy.research)"
$i = Invoke-RestMethod "http://127.0.0.1:7464/api/inbox?token=$tok"
"inbox: items=$($i.items.Count) unread=$($i.unread)"
$dash = Invoke-RestMethod "http://127.0.0.1:7464/api/dashboard?token=$tok"
"dashboard: unreadInbox=$($dash.unreadInbox) status=$($dash.status)"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*--port*7464*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
```

Expected: `autonomy: enabled=False idle=30 daily=24 research=True`, `inbox: items=0 unread=0`, `dashboard: unreadInbox=0`. Autonomy is **off by default** — no tokens are spent until the user turns it on.

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md README.md site/index.html
git commit -m "chore: v1.3.0 - autonomous processes"
```

---

## Phase 2 acceptance summary

- [ ] Autonomy is off by default; once on, the idle threshold, daily limit and research permission are configurable
- [ ] Polling (GET) does not trigger the DMN; a request that changes user messages/approvals/state does
- [ ] An autonomous session has no write/exec tools; a network read does not wait for approval, a non-network call is rejected instantly
- [ ] `web_search` returns `{ok:false}` without a network and does not invent
- [ ] Distillation rejects a note containing an invented URL
- [ ] `sleep()` skips autonomous sessions and advances the checkpoint
- [ ] The inbox is persistent, 24h dedupe, and the read mark survives a rebuild
- [ ] The DMN applies a 10 min cooldown + daily limit; tick does not run after `stop()`
- [ ] At most one greeting notification for the returning user
- [ ] Shadow mode only reads, runs no commands
- [ ] `/api/inbox` requires a token; 404 when there is no inbox
