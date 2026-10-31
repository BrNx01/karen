# KAREN v1.0.0 — Design Document

Date: 2026-10-26
Status: Awaiting approval
Previous: `2026-10-24-second-brain-ide-design.md` (v1 core), `2026-10-25-karen-v2-command-center-design.md` (dashboard, world model, voice)

## 1. Intent

KAREN works today but is toy-grade in three places: memory decay uses a fixed
half-life, the world model is time-blind, and the brain has no self-improvement at
all. v1.0.0 replaces these with the best practices from research, raises provider
support to OpenCode breadth, and simplifies the UI.

Goal: a JARVIS that genuinely makes the user's work easier, learns on its own, but
cannot lift its own gate.

## 2. Research findings and what they mean for us

| Source | Finding | Our counterpart |
|---|---|---|
| zenbrain, plast-mem, Engram, Pensyve | **FSRS** power-law decay; weights trained by Anki | §7.1 — FSRS curve instead of a fixed 30-day half-life |
| Engram (Bjork & Bjork) | **Dual strength**: storage strength does not fade, retrievability resets | §7.1 — `storage` and `retrieval` separate |
| plast-mem | If **surprise** is high, initial stability increases | §7.1 — `surprise` coefficient |
| Graphiti, zeit, fgraph, Temporal | **Bi-temporal** facts: the interval it is valid in the world + the moment it was written; a contradicting fact does not delete the old one, it supersedes it | §7.2 — `valid_from`/`valid_to`, `as_of` query |
| membrane, memex | **Revision operations**: supersede/fork/retract + audit trail | §7.2 — already exists, validity is added |
| AiDE Memo, fgraph | Provenance mandatory, default path without an LLM | Already exists (§ evidence gate), preserved |
| Self-modifying agent literature (Oxagen, METR, swarmsignal, nfh-loop) | **Proposer ≠ approver**; change = patch; rollback mandatory; some files can never be edited ("recursion floor"); a deterministic gate overrides the LLM's word | §7.3 — proposal-based self-improvement |

## 3. Goals

- Memory decays with FSRS + dual strength + surprise; measurable, testable.
- The world model is bi-temporal; "what is true now" and "what was true in March"
  are answered separately.
- The brain can propose changes to its own identity, rules, skills **and limited
  code**; applying them is the user's single click.
- Providers supported by OpenCode are set up with one click.
- Map: regions stay, inside them a real force layout; panel count 9 → 6.
- Turkish UI texts (code, error, empty state).

## 4. Non-goals

- Automatic (unapproved) code change — the user chose B, not C.
- Training FSRS weights on our own data (Anki weights are used).
- Embedding-based vector search — BM25/FTS + graph is enough, no model download.
- Multi-user, cloud synchronization.
- Automatic update (no certificate).

## 5. Anti-goals

- If the brain can change its own approval/permission gate, settings schema or
  proposal auditor → failure.
- If an applied proposal cannot be reverted → failure.
- If the memory score produces a made-up number (one without a source) → failure.
- If a fact whose validity has ended is presented as "true now" → failure.
- If adding a provider requires writing code (except Google) → failure.

## 6. Approaches (selected)

### 6.1 Self-improvement — **B: proposal-based, approved, revertible** (chosen)
Alternatives: A (behavior only) is too limited; C (autonomous) risks lifting its
own gate. B is the exact counterpart of the user's sentence "let it ask me for
permission on important improvements".

### 6.2 Memory — **FSRS + dual strength** (where research converges)
Alternative: the current exponential decay — not measurable, does not model the
effect of repetition.

### 6.3 World model — **bi-temporal** (Graphiti/zeit common model)
Alternative: the current single time — an old fact looks like "now".

### 6.4 Providers — **registry table + 2 adapters**
Alternative: a separate adapter per provider — 13 adapters to maintain, all
speaking the same protocol.

## 7. Design

### 7.1 Memory: FSRS + dual strength + surprise

A note has two strengths:

- `storage` (storage strength) — **never fades**, increases with every successful
  recall. This is the real measure of permanence.
- `retrieval` (retrievability) — derived from FSRS stability, falls over time.

FSRS curve (Anki default weights, w20 = 0.1542):

```
decay  = -w20                       // ≈ -0.1542
factor = 0.9^(1/decay) - 1
R(t)   = (1 + factor * t / S)^decay // t: days, S: stability (days)
```

Normalized so that `R(S) = 0.9`. Recall:

```
S' = S * (1 + 0.5 * (11 - D) * S^(-0.2) * (e^(0.2*(1-R)) - 1))
```

- `D` (difficulty) 1..10; correction and rejection increase difficulty.
- Every successful recall grows `S` → the same note lasts longer.
- **Storage strength:** `storage = storage + 1` (never decreases), cap 20.

Combined score (search ranking):

```
final = rrf_score * (0.7 * R(t) + 0.3 * min(1, storage / 10))
```

**Surprise:** during distillation, if the note has low similarity to the closest
existing note (new information) its initial stability increases:
`S0 = base * (1 + surprise * 0.5)`.

**Decay (cold storage):** if `R < 0.15` **and** `storage < 3` it goes cold. A note
with `storage >= 3` never goes cold — something recalled a lot is permanent.

**To be added to the table:** `stability REAL`, `difficulty REAL`, `storage REAL`,
`last_review INTEGER`, `surprise REAL`. Migration via `ALTER TABLE` (existing
notes `stability = 30`, `difficulty = 5`, `storage = 1`).

**Tool:** `memory_review` (like the existing `world_*`, `read`) — marks the
recalled note as "was useful"; `S` grows.

### 7.2 World model: bi-temporal facts

Two columns on `world_facts`:

- `valid_from` (already there, `validFrom`)
- `valid_to` (new) — `NULL` = still valid

When writing a new fact, if there is a valid fact under the same
`entity + attribute` and the value differs: `valid_to = now` is written to the old
one (not deleted, linked to the new one with `superseded_by`). Thus:

- `world_compute` by default sees **only valid** rows.
- `world_query {asOf}` asks about a past moment.
- Conflict marks (existing) are preserved — a conflict still goes to the user when
  it means "both are valid".

Tools: `asOf` on `world_query`, an `includeHistory` parameter on `world_compute`.
The context text enters under the heading "valid facts"; past rows only on an
`asOf` request.

### 7.3 Self-improvement: proposal-based, approved, revertible

**Proposal object** (`server/growth/proposals.ts`):

```
Proposal = {
  id, createdAt, status: 'pending' | 'approved' | 'rejected' | 'applied' | 'reverted',
  kind: 'identity' | 'rule' | 'skill' | 'code',
  title, reason,
  files: { path, before, after }[],   // patch: full content (small files) or diff
  rollback: { commit: string } | { files: {...} },
  risk: 'low' | 'medium' | 'high',
  checks: { name, ok, detail }[],      // deterministic pre-checks
  appliedAt?: number, revertedAt?: number
}
```

**Flow:** the brain calls the `propose_change` tool → the proposal is written to
disk and a badge appears on the dashboard → the user says "Apply" or "Reject" →
apply: `git commit` (single commit), files are written, the proposal becomes
`applied` → "Revert": `git revert` or the saved `before` content is written back.

**Protected surface (can never be proposed, the auditor rejects it):**

- `server/engine/permissions.ts` (permission classifier)
- `server/growth/**` (proposal system, auditor, approval)
- `server/settings.ts` (settings schema)
- `server/http/approvals.ts`, `server/http/server.ts` (approval path, token)
- `server/store/events.ts` (log integrity)
- `test/**` (tests cannot be weakened)
- `electron/main.cjs` (shell security)

The auditor does this **deterministically**: path list comparison, the LLM's "this
is harmless" opinion is invalid.

**Deterministic pre-checks** (if any fails, the proposal is `rejected` and never
shown to the user):

1. `size` — total patch ≤ 200 lines, at most 3 files.
2. `protected` — none of the paths in the list above.
3. `tests-intact` — no deletion/weakening under `test/`.
4. `build` — the patch is applied in a temp copy, `tsc --noEmit` passes.
5. `suite` — `npm test` passes in the temp copy (existing 287+ tests).
6. `no-secrets` — no key/password pattern in the patch text.
7. `scope` — `package.json` adds no dependency (a new package is a human decision).

Temp copy: `os.tmpdir()/karen-proposal-<id>`; `git worktree` or a file copy. On
failure the copy is deleted.

**Risk class (shown to the user):**

- `low` — identity/rule/skill text (not code)
- `medium` — `app/**` (UI)
- `high` — `server/**` (engine, memory, world model)

The user can say in settings "show only low-risk proposals"; high risk always asks
for approval (default).

**The brain learning on its own (without a proposal, safe):**

- Memory notes, world facts, skill usage statistics: free.
- Identity/rule files: proposal only (if the user wrote it, the user's version wins).
- Code: proposal only.

**Tools:** `propose_change {kind, title, reason, files}`, `growth_status {}`
(pending proposals + recently applied).

### 7.4 Provider registry table

`server/engine/providers/registry.ts`:

```
ProviderSpec = {
  id, label, kind: 'anthropic' | 'openai',
  baseUrl?: string, apiKeyEnv?: string,
  local?: boolean, docs?: string
}
```

Records: `anthropic`, `openai`, `google` (custom adapter), `ollama`, `lmstudio`,
`llamacpp`, `groq`, `cerebras`, `deepseek`, `mistral`, `openrouter`, `together`,
`xai`, `azure-openai`, `custom`.

- `openai` kind → the existing `OpenAICompatibleProvider` (one-line record).
- `anthropic` kind → the existing adapter.
- `google` → new `GoogleProvider` (Gemini `generateContent` stream; a separate
  adapter, because its protocol differs).
- `custom` → the user enters a base URL + key.

The settings screen is generated from the registry table: each card shows the
name, local/cloud label, whether a key is required, and an "installed?" indicator
(port probe for local).

### 7.5 Map and UI

**Map:** Region cards stay (only the clicked one opens). Inside a region, instead
of a fixed ring, a force-directed layout: nodes settle with link attraction +
repulsion, the result is computed once and cached (static). Concept nodes sit in
the center, notes near their concepts; link strength determines distance. It stays
readable at 500 notes.

**UI:** The dashboard drops from 9 panels to 6:
1. Core (status + sphere + 4 counters)
2. Live feed
3. Agents
4. Recent actions
5. Memory (insight + cold)
6. System + model (combined)

Quick commands move to the bottom conversation bar (already there). System
indicators shrink to a small strip.

**Turkish:** all user texts (error, empty state, button, settings label) are
Turkish; code identifiers stay English.

### 7.6 v1.0.0 release

`package.json` version `1.0.0`, footer on the dashboard, release notes in the
README.

## 8. Phases

1. **Memory (FSRS + dual strength).** Table migration, formula, decay rule,
   `memory_review`.
2. **World model (bi-temporal).** `valid_to`, supersede, `asOf`, `includeHistory`.
3. **Provider registry table + Google adapter.** The settings screen is generated
   from it.
4. **Self-improvement (proposal).** Proposal store, deterministic auditor, temp
   copy tests, apply/revert, queue on the dashboard.
5. **Map + UI simplification + Turkish + v1.0.0.**

Each phase works on its own and closes with its tests.

## 9. Verification

- Memory: in 60 days of artificial time, a never-recalled note goes cold; one
  recalled 3 times **does not**; `R(S) ≈ 0.9`; storage strength does not decrease.
- World model: "budget 500 TRY" then "budget 700 TRY" → today 700, `asOf` at an
  old date 500; the old row is not deleted, `valid_to` is set.
- Providers: every `openai` kind provider in the registry table is installed if a
  key exists; the Google adapter is tested with a fixture.
- Proposals: protected file → rejected (test); test weakening → rejected; a patch
  that breaks the build → rejected; a passing patch is applied and reverted with
  `git revert`.
- UI: 6 panels; the page does not scroll; the map opens at 500 notes.

## 10. Risks

- **FSRS parameters** are trained on Anki data; they may not be ideal for our
  memory. Mitigation: coefficients are configurable, defaults conservative.
- **The proposal auditor** may leave a hole through which the brain can propose
  harmful code. Mitigation: the protected list is deterministic, tests in a temp
  copy, user approval, git revert.
- **The Google adapter** is written without being tried against the real API.
  Mitigation: fixture test + a "test connection" button.
- **Scope**: five phases, each large. If the order is not kept, none of them
  finishes.

## 11. Left to the builder

- Force layout parameters (repulsion/attraction coefficients).
- Proposal diff format (full content or unified diff) — full content for small
  files.
- In-panel CSS layout.
- Stream parsing details of the Google adapter.

## 12. Decisions (after the builder's audit)

### 12.1 Code proposals only in the source copy (limit)

The packaged application runs from inside `app.asar` — read-only, not a git repo,
no `tsc`/`vitest`. Therefore:

- **Code proposals** work only in the source copy (`npm run karen -- serve`,
  `npm run desktop`). In the packaged app this section says "code improvement is
  available in the source copy" and accepts no proposals.
- **Identity / rule / skill proposals** work everywhere (written to the data
  folder).
- An applied code proposal takes effect **on the next start**; the running process
  does not reload itself (no silent restart).

### 12.2 Memory state is event-sourced

Whenever `stability`, `difficulty`, `storage`, `last_review`, `surprise` change, a
`memory_score` event is written **with computed values**. `rebuild` replays these
values; so "storage strength never decreases" also holds after a rebuild.
Migration defaults for existing notes: `stability = 30`, `difficulty = 5`,
`storage = 1`, `surprise = 0`.

### 12.3 What counts as a "recall"

- **Automatic context injection** only updates `S` (at most once per note per day);
  it does **not** increase `storage`.
- An **explicit signal** increases `storage`: the `memory_review` tool, the user
  correcting a note, the user explicitly opening a note.
- So "it entered context twice → immortal" does not happen; the decay system stays
  meaningful.

### 12.4 Apply and revert path

- **Code proposal:** rejected if the working tree is not clean; `HEAD` must match
  the recorded base. Apply: `git add` only the proposal's files + a single commit;
  the commit id is written into the proposal. Revert: `git revert <commit>`.
- **Identity/rule/skill proposal:** written under `dataDir`, reverted by writing
  back the `before` snapshot; git is not needed.
- Paths must be relative to `dataDir` and may only be under `brain/identity`,
  `brain/rules`, `skills/<id>`.

### 12.5 Protected surface = allowlist (not denylist)

A proposal may only target these paths: `app/**`, `server/memory/**`,
`server/dashboard.ts`, `docs/**`, and the data paths in §12.4.

Everything else — `server/engine/**` (tool registry, loop, permissions),
`server/sessions.ts`, `server/http/**`, `server/store/**`, `server/settings.ts`,
`server/growth/**`, `test/**`, `electron/**`, `package.json` — **cannot be
proposed**. So "the brain cannot lift its own gate" becomes structural, not
dependent on a list update.

### 12.6 Runtime of the pre-checks

- Temp copy: `os.tmpdir()/karen-proposal-<id>`; `node_modules` is linked into the
  live store (Windows junction, POSIX symlink). `npm install` is **not run**.
- `tsc --noEmit` + `vitest run` run in the background; the proposal moves through
  `pending → checking → ready | rejected`.
- If the link cannot be made, the check is marked "could not verify"; the proposal
  is still shown but counted as **high risk** and requires explicit approval to
  apply (no silent pass).

### 12.7 Settings schema (separate per provider)

- `secrets` is now `{ [providerId]: key }` (the existing `anthropic`/`openai`
  migrate).
- Inside `providers`: `{ [id]: { baseUrl?, model?, apiVersion?, deployment? } }`;
  there is a single *active* provider, but each provider's own settings are kept.
- `azure-openai` is a separate kind: `api-key` header + `api-version` query
  parameter + `deployment` path segment. `custom` = OpenAI compatible + base URL.

### 12.8 World model: when is it "the same fact"

- Supersession happens **only** when the attribute comes from the allowlist (does
  not fall back to the type default) **and** the type/unit are the same.
  Otherwise rows live side by side (existing behavior).
- `valid_to` is **exclusive**: a fact ending at T is not valid at T.
- `includeHistory` is only meaningful for `latest`/`earliest`/`next`/`asOf`.
  `sum`/`avg` always sum only valid rows; if history is requested it returns
  `{ value: null, reason: 'past rows cannot be summed' }` (no made-up total).

### 12.9 `base` and `corrected` are preserved

- `base` contributes to the initial stability (`S0`) and to difficulty.
- A successful review **lowers** difficulty; correction/rejection **raises** it.
- The combined score replaces `strength()`, but the "corrected note is stronger"
  behavior is preserved via difficulty (existing tests expect this behavior).

