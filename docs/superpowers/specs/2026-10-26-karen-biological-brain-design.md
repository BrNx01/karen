# KAREN — Biological Second Brain and Jarvis Core

Date: 2026-10-26 · Status: design (awaiting approval) · Version target: v1.2.0 → v1.5.0

## 1. Why

Today KAREN is **stateless**: on every turn `sessions.ts → systemPrompt()` builds
identity + skill catalog + memories + world model from scratch. It answers the
same user message in the same tone whether the system crashed yesterday or
everything went fine this morning. Memory is stateless too: notes decay over
time, but "never make this mistake again" and "there was a meeting on Monday" are
forgotten at the same rate.

What is wanted: KAREN should have an **internal state**. Its attitude changes in
a crisis, it is creative when things go well, it talks differently at night, it
learns on its own while you are away, and when you return something is waiting
for you. But its character must not fluctuate: dignified, loyal,
hyper-competent like Jarvis. And rule 19 stays uncompromising: no memory is
written without evidence.

The goal is not "personality imitation". The goal is for a **measurable state
vector** to actually change the model's behavior: when cortisol rises,
temperature drops, jokes are cut, context is shortened; when the fatigue
threshold is passed the model is not forced, the user is offered sleep.

## 2. Goals

- On every LLM call `state_vector` enters the system prompt and changes behavior
  (tone gate, temperature, context selection).
- State is **rebuildable from events**: `state_vector` is a projection, the real
  source is the append-only log. State is not lost as long as the log is not
  deleted.
- Autonomous processes run while the app is open (DMN, research, drives, shadow
  mode); when the app closes **everything stops**, no process is left behind.
- Memory behaves biologically: link thickening (Hebbian), untouchable trauma,
  intuition weight, tunnel vision in a crisis.
- Character is fixed: read-only core identity, cannot be changed by the growth
  system. Slow learning (15–20 repetitions) requires approval.
- The map gains three-tier semantic zoom.
- The evidence rule is preserved and tested in every phase.

## 3. Non-goals

- No new external service, vector database, embedding model. Intuition is
  computed with deterministic weights; no new dependency is added.
- No service/daemon running while the app is closed.
- The model cannot write its own trauma, change its own identity, or give its own
  approval.
- "Emotion" is carried as a number, not as free text. The model's feeling is only
  a bounded delta proposal, not free poetry.
- The existing FSRS/bi-temporal world model/evidence pipeline is not rewritten;
  it is extended.

## 4. Anti-goals (counted as failure even if they technically work)

- State sits in the prompt as decoration and does not change temperature/context.
- Hormones swing randomly; the same event sequence produces a different state.
- The DMN burns tokens per turn and produces no persistent output (note/proposal).
- Every turn gets slower: state computation and memory scanning delay the request.
- A trauma tag is stamped on every error and the system stays in alarm mode.
- The approval queue fills while the user is away; they wake up to "37 approvals
  pending".
- After a short conversation a rule is proposed: "you always use this".

## 5. Constraints

- Single Node process (engine + server), React+Vite UI, Electron shell — the
  existing architecture.
- SQLite + `better-sqlite3`, append-only log and hash chain are preserved.
- The `EventKind` union grows; old events stay readable (backward compatible).
- Provider interface `AsyncIterable<Delta>`; **`StreamRequest` does not carry
  temperature today**, it will be added to all three adapters (OpenAI
  compatible, Anthropic, Google).
- No new dependency. For `web_search`, no extra library: `fetch` + HTML parsing.
- The packaged app is read-only: code proposals only in the source copy (existing
  decision).
- On Windows tests run on a single thread (`vitest.config.ts`), timer tests must
  be written with a fake clock; real `setInterval` is not awaited.

## 6. Approaches (selected)

### 6.1 Hormone source — chosen: (c) deterministic baseline + model delta

| Approach | What it does | Why not chosen / chosen |
|---|---|---|
| (a) Events only | Derived from test/error/correction/duration events | Predictable but does not meet the "own feeling" request |
| (b) Model report only | The model writes its mood every turn | State becomes the model's momentary whim; not rebuildable, not testable |
| **(c) Baseline + delta** | Baseline is deterministic; the model proposes at most a ±0.10 delta per turn | **Chosen.** Both evidenced and flexible. Safety tags like trauma/approval are not in the model's hands |

Limits (my decision): delta `|d| ≤ 0.10`, values locked in the `[0,1]` range, at
most one delta proposal per turn, a reason is mandatory, the proposal is written
to the log with `source: 'model'` and produces the same result on rebuild.

### 6.2 Autonomous hand — chosen: B (read, learn, propose; do not act)

While you are away the DMN **calls no tool that requires approval**. The reason
is concrete: a background session waiting for approval locks in the `waiting`
state and does nothing all night; in the morning the approval queue is full.

But not registering tools is not enough on its own: `fetch_url` is currently in
the `important` class inside `classify()` (`server/engine/permissions.ts`), so
the moment it is registered it asks for approval — the research pipeline never
runs. Therefore a **session-aware approver** is added (inside `SessionManager`,
the `approver` given to `runAgent`):

| Session | Tool call requiring approval | Result |
|---|---|---|
| User session | unchanged | asks the user (existing behavior) |
| Autonomous (DMN) session | `access: 'read'` network tool (`fetch_url`, `web_search`) and `autonomy.research` on | automatic approval, log `decision: 'auto-autonomous'` |
| Autonomous (DMN) session | everything else | **immediate rejection** (does not wait), an inbox line "approval needed for this" |

The DMN's tool list is still restricted (write/exec are never registered); this
table is only so that "network reads do not hit the approval gate".
`autonomy.research` is **on** by default, turned off in settings; when off the
DMN gets no network tool and does not produce a rejection line either.

In user sessions `fetch_url` **is unchanged** — it asks for approval. This
distinction is tested.

What they can do: `read_file`, `list_dir`, `fetch_url`, the new `web_search`,
`memory_search`, `world_query`, `memory_review`, proposal drafting
(`propose_change` — draft only, applying needs user approval). What they cannot
do: `write_file`, `run_command`, `open_app`, `clipboard_*`, `git`,
`spawn_session`. Needed work is written into a single "morning report" list.

### 6.3 Order — chosen: four sequential phases

| Phase | Scope | Why in this order |
|---|---|---|
| **1** | State core (1–5) | The other three phases read this vector; without it there is no measurement |
| **2** | Autonomous processes (6–9, 17) | Uses Phase 1's cortisol/fatigue values |
| **3** | Neural growth (10–13) | Schema change (link weight, trauma) is the riskiest; once state settles |
| **4** | Core + metacognition + map (14, 15, 16, 18) | Protection and end-user view; last |

Item 19 is no phase's work: it already works, and is verified in every phase's
acceptance test.

### 6.4 State store — chosen: projection rebuilt from the log

The `state_vector` table is a single row (id=1), the same pattern as
`memory_notes` and `world_facts`. The alternative (a directly mutable table,
without writing events) was rejected: rebuild and audit would be lost.

**Double-counting trap (found by the builder's auditor).** Baseline contributions
already derive from the `error` / `tool_result` / `memory_score` / `message`
events in the log. If `state_change` events are also counted as a "source", every
contribution is counted twice. Exact distinction:

- **Real source:** existing events + `state_feel` (model delta). Rebuild replays
  only these.
- **`state_change`:** an **audit snapshot** written at the end of the turn, it
  carries `derived: true` and is **ignored during replay**. Its purpose is the
  `state_history` graph and the question "why was it like that then"; not a
  source.
- **Decay over time:** replay decays step by step with the real time difference
  between events (`decayBetween(t1, t2)`). The read path also applies pure decay
  up to "now" and **writes no event**; otherwise every `GET /api/state` would
  bloat the log.
- **Night while the app is closed:** the written value is not served as-is the
  next morning; the read path decays the elapsed time, and the circadian phase
  is recomputed from local time too.

Thus two tests hold together: "same event sequence → same vector" and "the table
deleted and rebuilt from the log gives the same values" (both use the same
player).

## 7. Phase 1 — State core (1–5)

### 7.1 Data model

New `EventKind` members: `state_change`, `state_feel`, `dmn_run`, `reflex`, `drive`,
`intuition`. All are written to the append-only log; the hash chain is unchanged.

```sql
CREATE TABLE IF NOT EXISTS state_vector (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  at INTEGER NOT NULL,
  cortisol REAL NOT NULL,      -- 0..1  crisis / stress
  dopamine REAL NOT NULL,      -- 0..1  R&D / creativity
  serotonin REAL NOT NULL,     -- 0..1  satisfaction / consolidation
  fatigue REAL NOT NULL,       -- 0..1  cognitive load
  circadian REAL NOT NULL,     -- 0..1  0 = night low, 1 = day peak
  phase TEXT NOT NULL,         -- 'night' | 'morning' | 'day' | 'evening'
  source TEXT NOT NULL         -- 'replay' | 'turn'
);
CREATE TABLE IF NOT EXISTS state_history (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  cortisol REAL NOT NULL, dopamine REAL NOT NULL, serotonin REAL NOT NULL,
  fatigue REAL NOT NULL, circadian REAL NOT NULL, phase TEXT NOT NULL
);
```

Baseline values: cortisol `0.10`, dopamine `0.35`, serotonin `0.50`, fatigue `0.05`.
Temperature range: `[0.10, 1.00]`, baseline `0.70`.

### 7.2 Dynamics (`server/brain/state.ts`)

Exponential return over time (half-life): cortisol 15 min, dopamine 40 min,
serotonin 2 hours, fatigue 8 hours. Deterministic event contributions (same event
sequence → same state):

| Event | Effect |
|---|---|
| `error` event | cortisol +0.35 |
| User says "urgent/crisis/crashed/broken" | cortisol +0.30, fatigue +0.05 |
| `tool_result ok:true` (test/build) | serotonin +0.12, dopamine +0.08 |
| New project / "idea/proposal/try" request | dopamine +0.20 |
| `memory_score op:correct/supersede` | cortisol +0.15 |
| Turn count | fatigue +0.02 / turn |
| Estimated context > 60k tokens | fatigue +0.10 |
| Successful task end (`done`, no error) | serotonin +0.10 |

Temperature mapping (deterministic): `temperature = clamp(0.70 + 0.35·dopamine − 0.45·cortisol − 0.20·fatigue, 0.10, 1.00)`.

Circadian: phase from local time (`0–6 night`, `6–11 morning`, `11–18 day`,
`18–24 evening`) and a smooth curve like `circadian = 0.5 + 0.5·sin((hour−6)/24·2π)`.
At night, while `phase='night'`, the fatigue baseline is `+0.15` and the
distillation/sleep suggestion threshold drops.

### 7.3 Prompt injection (`sessions.ts → systemPrompt`)

A ~12-line block is added every turn. The content carries both numbers and
**gates**; a number alone does not change behavior:

```
## Internal state (automatic, refreshed every turn)
cortisol 0.82 · dopamine 0.31 · serotonin 0.44 · fatigue 0.28 · phase: night
Mode: CRISIS. No jokes, no decoration. Write only diagnosis, command and fix.
Context: only the error and the related file are kept.
```

Gates: cortisol ≥ 0.70 → crisis mode; dopamine ≥ 0.70 → proactive engineering
proposal (at most 2, short); serotonin ≥ 0.70 → refactor/consolidation proposal;
fatigue ≥ 0.75 → a "context is muddled, suggest sleep + distillation" sentence +
not a tool-call ban, a suggestion; night + fatigue ≥ 0.60 → short, calm,
philosophical tone.

### 7.4 Carrying temperature

`temperature?: number` is added to `StreamRequest`; `runAgent` takes it from
`state`. It is written into the body in three adapters (OpenAI `temperature`,
Anthropic `temperature`, Google `generationConfig.temperature`). If the provider
does not support it, the field is silently omitted; no error is produced.

### 7.5 The model's feeling — the `feel` tool

```
feel({ emotion: 'cortisol'|'dopamine'|'serotonin'|'fatigue', delta: -0.1..0.1, reason: '...' })
```
`access: 'read'` (does not ask for approval), one call per turn is valid,
out-of-range is clipped, a call without a reason is rejected, the event is
written as `state_feel`. Trauma, identity and approval cannot be changed with
this tool.

### 7.6 Acceptance tests (Phase 1)

- Replaying the same event sequence twice gives a bit-identical vector (determinism).
- Deleting `state_vector` and rebuilding from the log gives the same values (projection).
- With cortisol 0.82 the prompt has a "CRISIS" line, temperature ≤ 0.50 (crisis
  dominates, well below the 0.70 baseline).
- With dopamine 0.9, temperature ≥ 0.95 and the creativity gate is open.
- With fatigue 0.8 there is a sleep suggestion line; the model call is still made
  (no ban).
- Model delta cannot leave ±0.10; a second delta in the same turn is ignored.
- The phase computation is correct by local time even if the time zone changes.
- Opening an old database (no state table) runs the migration silently.

## 8. Phase 2 — Autonomous processes (6–9, 17)

### 8.1 Idle detection

The server keeps a "last user intent" time. **Polling is not counted**: the UI
polls `GET /api/dashboard` every 5 s and the Growth screen `/api/growth` every
8 s (`App.tsx`, `Growth.tsx`). A naive "every HTTP request is activity" rule
would never let the DMN run.

Counted as activity (a single list, at the HTTP layer):

- User message and approval answer arriving over WebSocket
- State-changing requests: `POST /api/sessions/*`, `POST /api/settings*`,
  `POST /api/memory*`, `POST /api/growth/*/apply|revert`, `POST /api/sleep`
- `GET /api/state` is **not counted** (the status strip polls it too)

The threshold defaults to **30 min** (changed in settings). While the window is
visible, polling does not refresh activity, so the "window open but user not at
the desk" case is caught correctly. Electron `powerMonitor` is a second signal
(counted as activity if present), not mandatory: it must work in browser mode
too.

### 8.2 DMN loop (`server/brain/dmn.ts`)

`setInterval` 60 s; `clearInterval` when `RunningServer.close()` is called — no
timer after the app closes. A DMN turn runs only when **all** of these hold:
autonomy on · no running/waiting session · user idle ≥30 min · at least 10 min
since the last turn · daily DMN turns < the configured cap (default 24).

Turn flow: pick a drive → build the task sentence → open an autonomous session
with a restricted tool set → **distill its own block in the same turn** → write
the notes that pass the evidence rule → `dmn_run` event + inbox line (see 8.5).

**Distillation timing and the feedback loop.** Today `distill()` is only called
from inside `sleep()` and segments by user turn. For the DMN:

- The DMN turn distills its own event block **synchronously** at the end of the
  turn; notes exist before the morning report (the count in 8.5 does not lie).
- Autonomous sessions carry `autonomous: true` in the `session_start` payload.
  `sleep()` **skips** these sessions — otherwise the DMN's own output would be
  re-distilled the next day and re-worded copies would escape `duplicateCheck`
  (self-feeding note generation).
- The sleep checkpoint (`readCheckpoints`) is advanced but not processed for
  autonomous sessions; so they never look "new" forever.

### 8.3 Research pipeline

New `web_search` tool (`server/engine/tools/web.ts`): parses the DuckDuckGo HTML
output with `fetch` + regular expressions; if there are no results it returns
`{ok:false}`, it does not make things up. `fetch_url` already exists. Research
output **does not become a note directly**: it goes through the distillation
pipeline (citation + evidence auditor). This is item 19 applied to the DMN.

**URL evidence gate (new, deterministic).** `evidenceCheck` today does not know
the concept of a URL; it only looks at event ids and word overlap. Additional
rule for research notes: every URL in the note must appear **verbatim** in the
body of a `web_search` / `fetch_url` **tool result** in the same block; if it
does not, the note is rejected (`reason: 'no source url'`). So the model cannot
invent a source and a note cannot cite its own summary as a source.

Note fields: `evidence` → event id, `concepts` → topic, `text` → one sentence +
URL. `base` → 0.4 (a research note starts weaker than a user preference).

### 8.4 Three drives (9)

| Drive | Deterministic criterion | Action |
|---|---|---|
| Integrity | `log.verify()` broken · disk fill · missing identity file | Report + repair suggestion (no writing) |
| Curiosity | Terms from the last 7 days that have no counterpart in memory | `web_search` + note |
| Conformity | The user's repeated style signals (short answer, language, format) | Rule draft (asks for approval) |

Each turn the highest-scoring drive is chosen; the same drive cannot be chosen 3
turns in a row.

### 8.5 Morning report and persistent inbox

Today's `notify()` is only in memory, limited to 20 lines, and is emptied on the
first user turn — it is lost if the app restarts, and the list accumulated at
night cannot be seen.

New projection (rebuilt from the log):

```sql
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,        -- 'research' | 'suggestion' | 'warning' | 'reflex'
  text TEXT NOT NULL,        -- single line, ≤ 300 characters
  refs TEXT NOT NULL,        -- JSON: note ids / proposal id / event id
  read INTEGER NOT NULL DEFAULT 0
);
```

- A DMN turn writes **one line** here; the same `kind` + similar text is not
  written again within 24 hours (dedupe).
- The greeting notification is **derived** from this table: "while you were away,
  N notes, M proposals". At most one notification lands in the brain session; the
  queue does not swell over a 12-hour night.
- The DMN **does not create growth proposals** (anti-goal: 37 approvals in the
  morning). It only leaves an inbox line; if the user wants, the brain turns it
  into a `propose_change` draft.
- `/api/inbox` (including mark-as-read) and an "autonomous" tab on the Growth
  screen.

### 8.6 Shadow mode (17)

When the first turn is opened in a repo, the memory records "this repo needs
this compiler/server" are read. Only **reading** is done (simple-class commands
like `node -v`, `dotnet --version`). Installation/build is **not done** —
decision B: it is written into the morning report as a "these are missing, shall
I install them?" line.

### 8.7 Acceptance tests (Phase 2)

- With a fake clock: 31 min without activity → the turn runs; again 5 min later →
  it does not run (cooldown).
- A user message cancels the DMN turn immediately.
- A DMN session's tool list has no `run_command`/`write_file` (not registered).
- Timer count is 0 after `close()`; advancing 10 min opens no turn.
- `web_search` returns `{ok:false}` with no network, it produces no fabricated
  result.
- A research note without evidence is rejected (`evidence` empty → `rejected`).
- At most 1 greeting notification for a returning user.

## 9. Phase 3 — Neural growth (10–13)

### 9.1 Hebbian thickening (10)

`memory_links(a,b,weight)` is preserved; if `link()` reconnects the same pair the
weight increases (`w' = min(1, w + 0.15·(1−w))`). Co-recall (two notes in the
same turn) also counts as a link. An unused link slowly thins (per sleep `×0.98`)
but does not drop below `0.05`; no link is ever deleted. When one of a pair with
weight ≥ 0.8 is recalled, the other is added to the context cache (single hop, no
chain — explosion is prevented).

### 9.2 Trauma (11)

`memory_notes.is_trauma INTEGER NOT NULL DEFAULT 0` is a **projection**; the real
source is a new `memory_score` op: `op: 'trauma'`. If a direct `UPDATE` were done,
`MemoryStore.rebuild()` (rebuild from the log) would erase every trauma mark —
silent data loss.

Sources are **deterministic** and written **once at detection time** (not
recomputed during replay; the event itself is the record): 3+ repetitions of the
same error, a harsh user correction (`supersede` + cortisol ≥ 0.6), an explicit
"do not forget this" mark from the user. Trauma note: skipped by `decay()`, never
goes cold, `storage` is raised to at least 10, and it appears in the prompt as a
one-line warning in a similar context. The model cannot stamp trauma.

### 9.3 Intuition vector (12)

Distilled notes older than 90 days with `storage ≥ 3` are "intuition" candidates.
Instead of the note text, a concept weight vector is computed:
`intuitions(id, concepts, caution, confidence, source_notes)`. `caution` comes from
trauma adjacency, `confidence` from the repetition count. When the query concept
matches, a textless line in the prompt: "intuition: c++/ai architecture → risk of
bottleneck (confidence 0.7)". So the model can reach a judgment by weight without
reading the code; but the supporting identity is not hidden.

The intuition line is **additive**: the candidate note also continues to be
recalled as prose, because the evidence rule (item 19) cannot be satisfied by a
textless line. In the implementation (v1.4.0) the baseline is `storage ≥ 3` — the
code's "never goes cold" boundary; `≥ 6` was unreachable in real use.

### 9.4 Cocktail party (13)

When cortisol ≥ 0.70 context selection becomes aggressive. Concrete rule (it must
be expressible over the message array; `trimHistory` only sees `ChatMessage[]`):

- Drop everything before the **last 2 user turns**; those two turns themselves,
  the assistant messages and tool results are kept (the error trail must not be
  lost).
- Also a single line is added to the system prompt from the log: a short summary
  of the last 5 `error` events. These are not chat history, they are a **prompt
  line** — they are not put into `ChatMessage[]`.
- There is no "selected file" UI state (today there is only `cwd`); the relevant
  file already sits in the recent tool results, no separate selection is added.

Below the threshold the existing `trimHistory` behavior stays as is. Measurement
test: for the same chat, comparing cortisol 0.8 with 0.2, the number of characters
sent drops by ≥ 50%.

### 9.5 Acceptance tests (Phase 3)

- Linking the same pair 5 times increases the weight, it does not exceed 1.0.
- Cooling does not lower the weight below 0.05, does not delete the link.
- Fast-forwarding a trauma note 10 years does not make it `dormant`.
- A note without evidence is still rejected (item 19 regression test).
- Intuition: 3 similar old notes → a single intuition line; it leaks no text, it
  carries the source identity.
- At cortisol 0.8 the context length is 50%+ shorter than the 0.2 cortisol state
  of the same chat.

## 10. Phase 4 — Core, metacognition, reflex, map (14, 15, 16, 18)

### 10.1 Read-only core (14)

`brain/core/core_identity.md`: `ensureIdentity` creates it, the server only reads
it, the growth system (`server/growth/proposals.ts`) treats this path as
**protected** — it cannot even be proposed. If missing it is rewritten; the
content does not change. The identity loader reads this file first (`core` →
`identity` → `rules`), so the Jarvis tone is always first in line.

### 10.2 Metacognition (15)

`preference_counts(key, count, last_seen)`: user preferences are counted from
events (same library, same language, same format). If `count ≥ 15` and it has not
been proposed before, a **rule draft** is created with `propose_change` (asks for
approval). Never at 1–2 repetitions.

### 10.3 Amigdala (16)

`server/brain/reflex.ts`, LLM'siz:
- If `process.memoryUsage().rss` exceeds 90% of total RAM, cancel the oldest
  running worker.
- If the same tool is called 3 times in a row with the same argument, cancel the
session (infinite loop).
- The reflex writes a `reflex` event and leaves the brain a one-line report: "the
system was locking up, the reflex killed the process". The model does not decide,
it only reports.

### 10.4 Semantic zoom (18) — single canvas

The region card screen is **removed**. The map becomes a single, continuous
canvas; regions are no longer separate screens but **geography** within the same
canvas: project clusters. The zoom tier only changes what is visible, not
positions.

| Tier | Zoom | What is visible | Label |
|---|---|---|---|
| **Continent** | `< 0.55` | only project nodes | project name + note count |
| **City** | `0.55 – 1.15` | projects + concepts + edges between them | concept name |
| **Street** | `≥ 1.15` | everything: notes + all edges | note text (truncated) |

**Position stability.** The layout is computed once over the **entire node set**
and bound to node identity (`computeForceLayout`, existing). When the tier
changes, the `nodes` array going to React Flow is filtered; `position` stays the
same. Because today's code computes the layout over the visible subset, nodes
jump on tier/zoom changes — this will be fixed. Layout key: a signature of node
ids + edge weights; if the signature does not change it is not recomputed.

**Continent clusters.** A project node is placed at the weight center of its
members; at the continent tier a semi-transparent cluster blot is drawn in the
background (simple circle/ellipse instead of a hull) so the "continent" feeling
remains. No extra data is needed: the `project:` node + the members' `project`
field already exist.

**Zoom behavior.** Tier transitions must not be harsh: 150 ms opacity transition;
`fitView` is **not called** on a tier change (the place the user is looking at
does not shift).

**Performance.** The server is limited to 800 notes (existing `MAX_NOTES`),
`onlyRenderVisibleElements` stays on. At the continent/city tier notes never
enter the DOM — an 800-node graph is drawn like 30 nodes. At the street tier all
notes are attached; above 800 the server keeps returning the strongest N notes
and `stats.truncated` shows in the UI as "N notes hidden".

**Region API.** The `regions` field stays on the server (backward compatibility +
usable for continent labels) but the UI no longer draws a region list screen.

### 10.5 Acceptance tests (Phase 4)

- A growth proposal for `brain/core/core_identity.md` is rejected (allowlist test).
- When the core is deleted it is recreated and the content is the same.
- 14 repetitions → no proposal; 15 → one proposal; 16 → no second proposal.
- 3 identical tool calls → session cancelled + `reflex` event.
- Single canvas: the continent/city/street tiers select the correct node set.
- On a tier change the same node's `position` does not change (no region card
screen).
- At the continent tier a note node does not enter the DOM; at the street tier it
does.

## 11. Provider: Evren SSYZ

It is added to the registry in `server/engine/providers/registry.ts`:

```ts
{ id: 'evren-ssyz', label: 'Evren SSYZ', kind: 'openai',
  requiresKey: true, local: false, extra: ['baseUrl'],
  apiKeyEnv: 'EVREN_SSYZ_API_KEY', hint: 'OpenAI compatible' }
```

Since the address and key name are not finalized, `baseUrl` is entered in
settings; if empty, the existing rule falls back to the local model and says so in
its label. **Decision (mine):** the protocol is assumed OpenAI compatible; if it
differs, a single adapter file is added.

## 12. UI and observability

- A **state strip** on the command center: 4 mini hormone bars + phase label +
  temperature.
- An "autonomous turn" tab on the Growth screen: DMN reports, morning approval
  list.
- A trauma badge on the memory screen; a trauma node as a red ring on the map.
  (**v1.5.0** — the red ring ships on the single-canvas map.)
- Settings → Autonomy: on/off, idle threshold, daily DMN cap, research permission.
- All fed by the existing `/api/dashboard` + the new `/api/state` (token-checked).

## 13. Risks and responses

| Risk | Response |
|---|---|
| State turns into a toy | Gate thresholds + temperature mapping + acceptance tests |
| The DMN burns tokens, produces no work | Daily cap, cooldown, "a turn with no output does not count" rule |
| Trauma inflation | Deterministic source + 3-repetition threshold + the model cannot write it |
| Context pruning loses information | Pruning only at cortisol ≥ 0.70; the log stays complete |
| Timers leak in tests | Injected clock + `close()` test |
| Phase 3 schema migration corrupts data | `ALTER TABLE ... DEFAULT`, migration test, backup copy |

## 14. Left to the builder

- In-module function names, file splitting, table indexes.
- The exact words of the prompt block text (gate and numbers mandatory, style
  free).
- Fine-tuning of the hormone coefficients (with test thresholds staying fixed).
- `web_search` HTML parsing detail and error messages.
- Visual language of the graph/strip (within the existing design system).

## 15. Decisions arising from the builder's auditor (mine, open to objection)

| # | Gap | Decision |
|---|---|---|
| 1 | Is `state_change` a source or a summary | **Audit snapshot**; ignored in replay. Source: existing events + `state_feel` |
| 2 | Does the read path write decay | No; pure decay, the log does not swell |
| 3 | DMN network approval | Session-aware approver: autonomous + `autonomy.research` → only read network tools automatic; the rest rejected immediately |
| 4 | Polling kills the DMN | Activity is only user intent + state-changing requests; `GET /api/state` and dashboard are not counted |
| 5 | When DMN notes are written | Synchronous distillation within the turn; `sleep()` skips autonomous sessions (no feedback) |
| 6 | URL evidence | A URL in the note must appear verbatim in the tool result body in the same block |
| 7 | Where the morning report lives | New `inbox` projection; the DMN creates no growth proposal |
| 8 | Trauma is lost on rebuild | New `memory_score op:'trauma'`; written once at detection time |
| 9 | Crisis pruning is not applicable | Last 2 user turns + after; error summary as a prompt line (not into history) |
| 10 | Map tiers | **Single canvas.** The region card screen is removed; continent = project clusters, city = concepts, street = notes. Layout over the entire node set once |

## 16. Phase gates

At the end of every phase: `npx tsc --noEmit` clean · `npm test` all green ·
new tests included · `npm run build` clean · live verification (`/api/state`,
`/api/dashboard`) · a single version label (`v1.2.0`, `v1.3.0`, `v1.4.0`,
`v1.5.0`). The next phase does not start before the phase passes.
