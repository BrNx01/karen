# KAREN — Design Document

The application's name: **KAREN**.

Date: 2026-10-24
Status: Awaiting approval

## 1. Intent and rationale

The user does not want a code editor; they want their own agent operation center.
Three things at once:

1. One-click button access to repos and agent repos.
2. A **second brain** that talks, remembers and grows over time — the application's
   main agent. Not a session; it opens sessions itself.
3. Real access to the computer: files, shell, processes. Not chat, work.

Why build an agent engine from scratch: we cannot steer the tool set, memory
injection and behavior rules of off-the-shelf agents from inside the loop. The
steering must live inside the engine.

Why memory like a human brain: in the user's mind there is a model of "a
much-discussed topic strengthens, an undiscussed one decays". That model is also
a good memory policy: weight by use instead of keeping everything equal.

## 2. Goals

- Brain full screen; the user normally talks only to it.
- While working, the brain opens its own sessions in the background; the user
  does not have to see them, but can view/select/open them manually from the
  menu below.
- Memory stays local, works with human-brain layers, is distilled over time.
- Model/API is replaceable (cloud or local). Personality is not tied to the API.
- Brain map: a graph with nodes and neural links that can be navigated and
  edited (Unreal Blueprint style).
- Every distilled piece of information is traceable back to the raw source.

## 3. Non-goals

- General-purpose code editor (syntax highlighting, language server, debugger).
  File viewing/editing exists; no full IDE experience.
- Multi-user / cloud synchronization. Single user, single machine.
- Plugin store, theme system, team features.
- Model training (weight updates). "Self-training" = context selection improving
  over time.

## 4. Anti-goals

- Information loss when the memory index breaks → counted as failure.
- The brain states a "fact" without a source confidently → counted as failure.
- The user cannot see/correct what the brain remembers → counted as failure.
- Background jobs silently drain the user's machine or wallet → counted as
  failure.

## 5. Constraints

- Windows first (development environment is Windows). macOS/Linux secondary.
- Must work without internet in local mode; cloud provider optional.
- API keys are not stored in plain text on disk; read via the operating system
  key vault (Windows DPAPI / macOS Keychain).
- Identity/behavior files the brain changes on its own do not take effect
  without user approval.

## 6. Approaches

### 6.1 Memory

- **A. Single pool + simple score.** Fast, but no distillation or layers.
- **B. Fully layered brain.** The requested model; but risk of information loss
  if the store breaks.
- **C. Event log + derived layers (chosen).** Every write goes to the immutable
  log; layers, scores, indexes are always derived from the log. If it breaks, it
  is rebuilt. Cost: discipline of two read paths (log + derived).

Selection rationale: memory is untrustworthy if it loses information when its
index breaks. C provides all of B and eliminates that failure class.

### 6.2 Engine

- **A. Wrap an off-the-shelf agent.** Fast start, the requested steering is
  impossible.
- **B. Loop from scratch + provider adapters (chosen).** Full control.
- **C. Loop from scratch + locked to a single provider.** Less work, conflicts
  with the model-switching requirement.

### 6.3 Interface

- **A. Terminal (TUI).** Fast but map and buttons are weak.
- **B. Browser first, then desktop shell (chosen).** The UI can be developed
  without waiting for the engine; the Electron shell is added later, the same
  code runs.
- **C. Lock into Electron from the start.** Early lock-in, slow feedback.

## 7. Architecture

```
app/                Electron shell + React UI (Vite)
  src/brain/        Full-screen brain chat, map, session menu
server/             Local HTTP + WebSocket server (single process)
  engine/           Agent loop, tool registry, permission layer, provider adapters
  brain/            Event log, layers, scoring, sleep pipeline, recall
  store/            SQLite (better-sqlite3) + identity/skill files
shared/             Shared types, protocol definitions
```

A single Node process carries the engine and the server; the UI talks over
WebSocket. This makes browser development and later desktop packaging possible
with the same code.

### 7.1 Provider layer

Single interface: `stream(messages, tools, options) -> AsyncIterable<Delta>`.
Adapters: `anthropic`, `openai`, `google`, `ollama` (local), `openai-compatible`
(any local server: LM Studio, vLLM, llama.cpp).

Each adapter converts tool calls to the common format. The engine does not know
the provider. Provider selection comes from settings; it can be overridden per
session.

### 7.2 Agent loop

1. System context is built: identity files + behavior rules + recalled memory
   (see 7.5) + environment info.
2. A request goes to the model, a stream comes back.
3. If there is a tool call: it passes the permission layer, runs, the result is
   appended to context.
4. Repeat until the model returns an end or the turn limit is reached.

**Permission layer.** Tools are divided into three classes:

- `read` — automatic (file read, search, listing)
- `write` — automatic inside the project root, approval outside
- `exec` — always approval (shell command), with a "remember this command"
  option for the session

Approval requests land in the UI and wait. Timeout = rejection.

**Approval authority (decided).**

- **Simple approval:** given by the brain itself. Definition: a **purely
  informational, side-effect-free** operation. Editing files inside the project
  root, reading, listing, searching; `git status/diff/log/show/branch/remote/rev-parse/ls-files`,
  `ls`, `cat`, `rg`, `find`, `echo`, `pwd`, `head`, `tail`, `wc`, `mkdir`,
  `touch`.
- **Important approval:** goes to the user, waits. Definition: writing outside
  the root, deleting (`rm`, `del`, `git reset --hard`, `git push --force`),
  **running an interpreter or package runner** (`node`, `npx`, `npm run`,
  `npm test`, `python`, `pip`, `cargo`, `go`, `dotnet`), **network access**
  (`fetch_url`, `curl`), git write operations (`push`, `commit`, `checkout`),
  command chaining (`&&`, `||`, `;`, `|`, `$( )`, backticks), changing system
  settings, changing identity/skill files, anything that spends money.
- **The approval boundary is the project root**, not the folder the model picks:
  `spawn_session` may only open a session under the current root or a registered
  repo.
- The decision is made **by a deterministic classifier** (command pattern +
  target path check), not by the LLM's "this is harmless" opinion. The LLM only
  offers a suggestion when the classifier says "unknown"; unknown = important.
- Every automatic approval the brain gives is written to the log and shown in
  the UI with a "brain approved" label. The user can review it retroactively.

**Background sessions** obey the same rule. When important approval is needed,
the session pauses, a badge appears in the bottom bar, the brain tells the user
"session X is waiting for approval" and keeps that job waiting (it can continue
with other work).

**Tools (first version):** `read_file`, `write_file`, `edit_file`, `list_dir`,
`search` (ripgrep), `run_command` (timeout + output limit), `fetch_url`,
`todo_write` (task list), `spawn_session`, `session_status`, `session_send`,
`session_cancel` (7.6).

**Session handle.** `spawn_session` does not wait; it returns a handle. Session
completion, approval waits and errors are reported to the brain as events. So the
brain can do other work while waiting and parallel sessions become meaningful.

**Context management.** When the context window fills: older turns are
summarized (engine-internal, not written to memory), tool outputs are shortened,
system context is preserved.

### 7.3 Store: event log

SQLite single file. The `events` table is **append-only**: no row is updated or
deleted.

```
events(id, ts, kind, actor, session_id, payload_json, hash, prev_hash)
```

`kind`: `message`, `tool_call`, `tool_result`, `permission`, `memory_note`,
`memory_link`, `memory_score`, `identity_change`, `session_start`,
`session_end`, `sleep_run`.

The `hash`/`prev_hash` chain: so that a row silently changed later can be
detected (integrity evidence, not a cryptographic security claim).

Derived tables (`notes`, `links`, `fts`, `vec`, `scores`, `sessions`) can always
be rebuilt from `events`. The `rebuild` command does this.

### 7.4 Brain layers

| Layer | Content | Lifetime |
|---|---|---|
| Short-term memory | Last turns of the active session | Ends with the session |
| Episodic memory | "What happened": event, project, time, outcome | Long, decays |
| Semantic memory | Facts, preferences distilled from memories | Permanent, revised on conflict |
| Skill memory | Behavior rules, identity | Permanent, files, user-approved |
| Cold storage | Memories whose strength falls below the threshold | Not deleted, dormant |

**Identity and skill files** (`brain/identity/*.md`, `brain/rules/*.md`) are read
and edited by a human and enter system context directly. The brain can change
them only as a **proposal**; it lands in the approval queue.

### 7.5 Recall: two lobes

When a question/context arrives, two searches in parallel:

- **Left lobe (exact):** FTS5 full text + project/person/time filters. "What,
  when, in which project."
- **Right lobe (associative):** similarity with local embedding vectors + graph
  neighborhood (spreading from a memory to linked concepts). "What does this
  remind me of."

Results merge into one list via Reciprocal Rank Fusion; they are re-ranked by
strength score and a recency multiplier. The top N notes enter system context,
each with its source event id.

If there is no embedding model (local model not downloaded), the right lobe is
silently disabled; the system keeps working with keyword search.

### 7.6 Scoring and decay

For each note `strength = clamp(0..1)`:

```
base       = importance (0..1 assigned during distillation)
recency    = exp(-age_days / half_life)      // half_life: 30 days
recall     = 1 + ln(1 + recall_count) * 0.3
correction = +0.4 if the user corrected it (permanent mark)
strength   = clamp(base * recency * recall + correction)
```

- `strength < 0.15` → cold storage (dormant), not deleted.
- `> 0.8` and recalled at least 3 times → "core" mark; slows decay.
- If the user says "forget", the note is marked `forgotten`, it does not appear
  in recall, it stays in the raw log (restore is possible).

Scores are written as `memory_score` events; so the past can be reverted.

### 7.7 Sleep cycle (distillation)

Trigger: the user says "sleep", 30 min idle, or N events accumulate. Only one
sleep runs at a time; it is protected by a lock. Every step is written to the
event log.

The pipeline runs as roles (see 7.8). Each role can be an LLM call or a
deterministic step. Deterministic steps run without an LLM (cost and
reliability).

**Evidence rule (non-negotiable).** Every distilled note must carry at least one
`event_id` citation. A note without a citation is **rejected at the
deterministic gate**. This gate is not left to the LLM.

**Conflict rule.** If a new note conflicts with an existing note on the same
topic (half of the content words shared + different negation): both stay, both
are marked, and it is presented to the user as a one-line question. Silently
overwriting is forbidden. The resolution comes from the user; the note not
selected is marked "forget", not deleted.

**Raw data policy.** The raw form of conversations stays in the log (for the
evidence chain). The memory presented to the user consists only of distilled
notes. Retention for the raw log is configurable (default 90 days).

**Immutability ↔ retention.** The log row is never touched. When the period
expires, a **`redaction` event** is written over it (which event, when, why) and
the raw text is deleted from a separate `event_bodies` table. The hash chain
keeps protecting the data as of write time, the integrity evidence is not
broken. An old note's citation shows as "source deleted"; it is not considered
invalid, but the evidence auditor flags it. Rebuilt memory cannot bring back
redacted text — this is expected behavior, not a fault.

### 7.8 Brain cells (roles)

The 20+ division of work the user asked for is set up as **20+ roles**, not as
**20+ concurrent processes**. Each role is a node on the map; most are
deterministic. Concurrent LLM calls are limited to 3 by default (configurable).

Distillation pipeline:

| # | Role | Type | Work |
|---|---|---|---|
| 1 | Segmenter | det. | Splits the conversation into topic blocks |
| 2 | Observer | LLM | Extracts candidate memories from a block |
| 3 | Memory writer | LLM | Turns the candidate into an episodic note |
| 4 | Meaning extractor | LLM | Extracts permanent facts/preferences |
| 5 | Self-distiller | LLM | Condenses similar notes into one |
| 6 | Evidence auditor | det. | Is each note's citation real, does the event exist |
| 7 | Conflict hunter | LLM+det. | New ↔ old conflict detection |
| 8 | Importance scorer | LLM | base importance 0..1 |
| 9 | Link builder | det.+LLM | Links notes to concept/project/person nodes |
| 10 | Repetition counter | det. | Recall count, strength update |
| 11 | Decay planner | det. | Moves below-threshold memories to cold |
| 12 | Dream | LLM | Cross-link: pattern between seemingly unrelated notes |
| 13 | Identity proposer | LLM | Proposes rule/identity change (approval queue) |
| 14 | Health auditor | det. | Index/log consistency, rebuild suggestion |
| 15 | Budget guard | det. | Skips LLM steps if there is no budget/permission; stops if the cap is exceeded |
| 16 | Red team | LLM | Attacks generated notes with "could this be wrong" |
| 17 | Summary writer | LLM | Shortens long notes |
| 18 | Language normalizer | det. | Reduces TR/EN terms to one form |
| 19 | Privacy filter | det. | Does not write key/password/TCKN patterns into notes |
| 20 | Sleep accountant | det. | Report of the sleep run |

Additional roles can be added (by configuration), but exceeding 20 is not a goal
by itself.

### 7.9 Orchestration: brain ↔ sessions

**Session** = one task: root folder, its own agent loop, its own transcript, its
own provider override. There are two roles: `brain` (one, the one the user talks
to) and `worker` (background work).

- The brain calls `spawn_session(task, cwd)`; it opens a session in the
  background, gets its identity, and returns immediately. When the work finishes,
  a **notification** is left for the brain; the notification enters context at the
  start of the next brain turn and is visible in the UI.
- Alongside are the `session_status`, `session_send`, `session_cancel` tools. The
  brain cannot manage its own session with these tools.
- The user does not have to see it. The menu below (like a folder picker) lists
  all sessions: status, folder, last message. Selecting one opens that session's
  transcript, and a manual message can be written.
- Concurrent background sessions default to 3; if the limit is exceeded the job
  is not started and the brain is informed.
- When a session ends, its summary enters memory as an episodic memory (during
  sleep).

### 7.10 Brain map

React Flow (Blueprint-style canvas): pan, zoom, move nodes, hover over a link,
click → detail panel.

- Node types: project, concept, person, memory, rule, session, cell (role).
- Size = strength score. Color = layer. Edge thickness = link strength.
- Faded nodes = cold storage. Hide/show toggle.
- Editable: delete/forget note, add/remove link, rename.
- Layout comes with automatic placement (force-directed), then the position the
  user moved is stored.
- The view is filtered on the large graph (layer, project, strength threshold).

**Semantic zoom / LOD.** The map is not drawn at one fixed detail; meaning
changes with scale:

| Scale | Visible |
|---|---|
| Far (whole brain) | Layer clusters and the main paths between them; no individual notes |
| Medium | If a single cluster is selected, the concept/project nodes inside it and the main links |
| Near | Note nodes, date, strength, short summary |
| Closest | Full text of the note, citations, editing tools |

Rules: shapes/colors instead of text when far; at threshold crossings nodes do
not disappear, they simplify (animate); the selected cluster stays in focus at
every scale (double click = enter, Esc = exit). Child details are only drawn
while they are visible on screen, so it stays smooth even with 10,000 nodes.
Clustering is automatic (by link density), the user can rename a cluster.

### 7.11 Buttons: repo and agent access

Card grid on the main screen: each card a repo/folder. Card = name, path, last
session, "open" button. Defined by `repos.json`; add/remove from the UI.
Ready-made templates for agent repos (reading AGENTS.md, tool permission
template). The button's job: open a session in that folder or tell the brain
"work in this repo".

### 7.12 Skill library: skill / agent repos

The user can add ready-made skill and agent definitions with one click; KAREN
uses them automatically.

- **Adding.** "Add skill" button: pick a local folder or paste a git URL. KAREN
  reads the repo, finds the `SKILL.md` / `AGENTS.md` / `agents/*.md` files, lists
  each skill with name + description + trigger + permission requirement. A
  preview is shown, the approved skill is taken in (copied under `skills/`; if
  the external repo changes, an "update" button).
- **Record format.** Each skill: name, description, when to use it, steps,
  required tools, permission class (simple/important), version, source. An
  unreadable file is not silently skipped, it lands in the warning list.
- **Automatic use.** Two stages: (1) while building context, skill names and
  triggers are given to the model as a short list, (2) if the model wants to
  load one, the full content enters context. So even with 50 skills the context
  does not bloat and the needed skill is known from the start.
- **Learning.** Which skill worked for which job is written to memory as a note;
  repeated success raises that skill's suggestion rank, failure lowers it. The
  "most used for you" ordering comes from here.
- **Security.** A skill cannot widen tool permission; it runs only in
  user-approved classes. Commands inside a skill pass the normal permission
  check. No skill can write directly into system context.
- **Scope.** Skills are global or project-based; a project skill is visible only
  in sessions under that root.

### 7.13 Sleep and shutdown

When the user closes the application, sleep continues in the background until it
finishes.

- Closing the window does not kill the process: the application minimizes to the
  system tray, sleep runs, and when done the process closes itself. Short
  notification: "KAREN is organizing memory".
- If "quit completely" is chosen, sleep continues in a separate background
  process; it exits when done. Steps interrupted midway are written to the log,
  so the next launch continues where it left off.
- If the computer shuts down, sleep is interrupted and continues from the
  `sleep_run` record at startup. Thanks to the lock, two sleeps never run on top
  of each other.
- If the application is reopened while sleep is running, "sleep in progress" is
  shown, and it can be stopped if wanted.
- Authority: sleep runs only with the model/budget previously permitted. Without
  permission, nothing runs at shutdown (7.14).
- So that "close" and "minimize to tray" are not confused on Windows, there is a
  setting: default close = minimize to tray + exit when sleep finishes.

### 7.14 Money and model policy (decided)

- **Default: no spending.** Unless the user explicitly permits it or defines a
  budget, no automatic job (sleep, background role, background session) calls a
  paid API. The default provider is the local model; if there is no local model,
  sleep does not run and the UI says "a model is required for sleep".
- Permission is given in two forms: "let this sleep run" (one-off) or a budget
  definition (monthly calls + token cap). When the budget is exceeded the job
  **stops**, it does not silently continue.
- Budget unit is calls + tokens; there is no money display. A price table brings
  maintenance burden and goes stale fast. Added later if wanted.
- Per-role model assignment: e.g. distillation local, red team cloud. The
  provider can be chosen separately for each role.

**Local model setup.** KAREN does not install or manage Ollama/LM Studio; it
finds them if installed, otherwise shows an install link and one-step
verification. The embedding model (~100 MB ONNX) is downloaded on first use with
user approval and kept in the application folder; so it works offline. Without
the model the right lobe is off, keyword search works.

**Memory view.** The map is a navigation tool; to audit memory there is a
separate, searchable **note list**: filter (layer, project, strength), note
detail, supporting citations, edit / forget / add link. User correction enters
here and is the strongest learning signal.

**Brain conversations.** The brain's chat is persistent and plural: conversation
list, resume on restart, compression by summarizing in a long conversation. The
brain is a "session" record but of a different kind from the other sessions; it
has tools, it opens sessions.

**Distribution.** Packaged with Electron. Code signing is targeted (the user
will provide the certificate); until the certificate is ready, a plain installer
is produced. Automatic updates are added only when signing and a release channel
are ready; not in the first version.

## 8. Interface structure

```
┌──────────────────────────────────────────────┐
│  Brain (full-screen chat)                    │
│                                              │
│   ... messages, tool cards, approval requests│
│                                              │
├──────────────────────────────────────────────┤
│ [sessions ▾] [map] [skills] [repos] [settings] │
└──────────────────────────────────────────────┘
```

- Default view is the brain chat.
- Bottom bar: session menu (opens like a folder picker), map, skills, repos,
  settings.
- Approval requests as cards in the chat; if any are pending, a badge in the
  bottom bar.
- Map is a separate view (full-screen canvas), one key away from the chat.
  Level-by-level detail with semantic zoom (7.10).
- Skills screen: add (folder/git), preview, on/off, project scope.
- Shutdown: "KAREN is organizing memory" tray notification, exit when done
  (7.13).

## 9. Phases

Each phase leaves something that works on its own.

**Phase 1 — Engine.** Provider adapters, agent loop, tools, permission layer
(simple/important classification), streaming, event log (only message/tool
events). Output: an agent runnable from the terminal.

**Phase 2 — Shell + chat.** Server, WebSocket, full-screen chat, session menu,
approval cards, repo buttons. Output: an application usable in the browser.

**Phase 2b — Skill library.** Skill/agent repo import, preview, two-stage
automatic loading, usage statistics (7.12). Output: skills added with one click
and engaged automatically. (Before Phase 3, because distillation roles can also
be defined as skills.)

**Phase 3 — Brain.** Layers, distillation pipeline (7.8), two-lobe recall,
scoring, sleep. Output: a brain that remembers and distills.

**Phase 4 — Orchestration.** `spawn_session`, background sessions, result
handoff, parallel limits. Output: the brain managing its own sessions.

**Phase 5 — Map + desktop.** React Flow map, node editing, memory note list,
Electron packaging, plain installer. Output: an installable desktop
application. (Signing + automatic update when the certificate is ready.)
## 10. Verification

- Phase 1: tool call + permission rejection + stream interruption tests;
  offline test with recorded responses for the provider adapter.
- Phase 3: (a) is a note without a citation rejected, (b) is a conflict silently
  overwritten, (c) are recall results the same after `rebuild`, (d) does decay
  move the expected nodes to cold in a 60-day artificial time advance.
- Phase 4: when a background session crashes, does the brain notice and report
  it.
- Phase 4b: does sleep finish when the application is closed; does sleep continue
  where it left off when the computer is force-shut and restarted; are two sleeps
  never parallel.
- Phase 5: is interaction smooth on a 500-node graph; do threshold crossings not
  flicker in semantic zoom; is the far view smooth at 10,000 nodes.

## 11. Risks

- **Distillation quality.** Bad distillation produces confidently wrong memory.
  Mitigation: evidence gate, red team role, user correction being the strongest
  signal, a screen where you can see every distilled note.
- **Cost.** Running background roles on every sleep can be expensive. Mitigation:
  deterministic first, LLM later; budget guard; concurrency limit.
- **Scope.** Six phases (including 2b), each large on its own. We stop between
  phases and check with the user.
- **Local model capability.** Small local models may be insufficient for
  distillation. Mitigation: per-role model assignment (distillation local, red
  team cloud, etc.).
- **Background work at shutdown.** Process management depends on the platform;
  on Windows tray + separate process works, but if the user kills it from Task
  Manager, sleep is interrupted. Mitigation: step-by-step log, resume at startup,
  lock. The promise is "it is not lost", not "it always finishes".
- **Skill supply.** Skill text from an external repo can carry prompt injection.
  Mitigation: preview + warning on import, ban on widening permissions, commands
  passing the normal check, source and version recording.

## 12. Left to the builder

- File names, module boundaries, the full column list of the SQLite schema.
- React Flow node visuals and layout parameters.
- Retry/backoff details, error message texts.
- Test file layout.
- Initial values of the sleep trigger thresholds (will be configurable).
