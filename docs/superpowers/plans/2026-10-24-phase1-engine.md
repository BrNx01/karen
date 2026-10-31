# KAREN Phase 1 — Agent Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A provider-agnostic agent engine that can call tools, is permission-supervised, writes every step to an immutable log, and runs from the terminal.

**Architecture:** A single Node/TypeScript package. `server/engine` holds the agent loop, provider adapters, tools and the permission classifier; `server/store` holds the SQLite-based append-only event log. Provider adapters speak a shared `AsyncIterable<Delta>` interface, so the loop does not know the provider. The UI (Phase 2) will use this engine over HTTP; in Phase 1 the CLI is enough.

**Tech Stack:** Node ≥ 20, TypeScript (strict, ESM), better-sqlite3, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-10-24-ikinci-beyin-ide-design.md` (§6.2, §7.1, §7.2, §7.3)

## Global Constraints

- TypeScript `strict: true`, ESM (`"type": "module"`), Node ≥ 20.
- Tests do not go to the network; all provider tests run on recorded responses (fixtures).
- The `events` table is append-only: no row is ever `UPDATE`d or `DELETE`d. A check in the test verifies this.
- Every operation that writes outside `cwd` is class `important`; no exceptions.
- Tool output is capped at 32 KiB; truncated output gets `…[truncated N bytes]` appended.
- `run_command` timeout defaults to 120 s; when it expires the process tree is killed.
- Unknown command name = `important` (the LLM's interpretation does not classify).
- Secrets are not written into code; API keys are read from the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
- Every commit message is Conventional Commits.

## Review Focus

1. Paths that escape `cwd` (`..`, absolute path, symlink) must count as `important` in write tools — if they slip through, writes land silently outside the root.
2. Megabytes of tool output must not bloat context and the log — cut at 32 KiB with truncation info visible.
3. `run_command` on a hanging/interactive command must die together with its child processes at timeout (`taskkill /T` on Windows).
4. If the provider stream breaks mid tool call, the half tool call must not run, the session must close with an error, and the log must stay consistent.
5. If the user cancels while waiting for permission, no command may run.

---

### Task 1: Scaffold, shared types, fake provider

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `server/engine/types.ts`
- Create: `server/engine/providers/fake.ts`
- Test: `test/engine/types.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `ChatMessage = { role: 'system'|'user'|'assistant'|'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string }`
  - `ToolCall = { id: string; name: string; args: unknown }`
  - `ToolDef = { name: string; description: string; inputSchema: Record<string, unknown> }`
  - `Delta = { type:'text'; text:string } | { type:'tool_call'; call:ToolCall } | { type:'usage'; inputTokens:number; outputTokens:number } | { type:'done'; stopReason:'end'|'tool_use'|'max_tokens' }`
  - `StreamRequest = { model: string; messages: ChatMessage[]; tools: ToolDef[]; signal?: AbortSignal }`
  - `Provider = { name: string; stream(req: StreamRequest): AsyncIterable<Delta> }`
  - `FakeProvider` (class, `providers/fake.ts`): `constructor(script: Delta[][])`, each `stream` call emits the next array; keeps a `calls: StreamRequest[]` record.

- [ ] **Step 1: Set up the scaffold**

`npm init -y`, then `package.json` fields: `"type": "module"`, `"engines": {"node": ">=20"}`, `"scripts": {"test": "vitest run", "build": "tsc -p tsconfig.json", "karen": "tsx server/cli.ts"}`. Dependencies: `better-sqlite3`; dev: `typescript`, `vitest`, `tsx`, `@types/node`, `@types/better-sqlite3`.

`tsconfig.json`: `target ES2022`, `module NodeNext`, `moduleResolution NodeNext`, `strict true`, `noUncheckedIndexedAccess true`, `outDir dist`, `include ["server","test"]`.

`.gitignore`: `node_modules`, `dist`, `*.db`, `*.db-journal`, `.karen/`.

- [ ] **Step 2: `git init` and the first commit**

```bash
git init
git add package.json tsconfig.json .gitignore
git commit -m "chore: scaffold karen engine"
```

- [ ] **Step 3: Write the failing test**

```ts
// test/engine/types.test.ts
import { describe, it, expect } from 'vitest';
import { FakeProvider } from '../../server/engine/providers/fake.js';

describe('FakeProvider', () => {
  it('emits and records requests', async () => {
    const p = new FakeProvider([[{ type: 'text', text: 'hello' }, { type: 'done', stopReason: 'end' }]]);
    const seen: string[] = [];
    for await (const d of p.stream({ model: 'm', messages: [], tools: [] })) {
      if (d.type === 'text') seen.push(d.text);
    }
    expect(seen).toEqual(['hello']);
    expect(p.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Verify the test fails**

Run: `npm test -- test/engine/types.test.ts`
Expected: FAIL — `Cannot find module .../providers/fake.js`

- [ ] **Step 5: Write `types.ts` and `fake.ts`**

`types.ts` carries the types above verbatim. `fake.ts`: `FakeProvider implements Provider`, `stream` is an async generator; it emits the `script` array in order, `calls.push(req)`, and when the script is exhausted it emits `{type:'done',stopReason:'end'}`.

- [ ] **Step 6: Verify the test passes**

Run: `npm test -- test/engine/types.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server test tsconfig.json package.json
git commit -m "feat: add engine types and fake provider"
```

---

### Task 2: Event log (append-only, hash chain, bodies, redaction)

**Files:**
- Create: `server/store/events.ts`
- Test: `test/store/events.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `EventKind = 'session_start'|'session_end'|'message'|'tool_call'|'tool_result'|'permission'|'error'|'redaction'`
  - `Actor = 'user'|'brain'|'session'|'system'`
  - `StoredEvent = { id:number; ts:number; kind:EventKind; actor:Actor; sessionId:string; payload:Record<string,unknown>; hash:string; prevHash:string }`
  - `class EventLog { constructor(dbPath: string); append(kind: EventKind, actor: Actor, sessionId: string, payload: Record<string,unknown>, body?: string): StoredEvent; appendBody(eventId: number, text: string): void; readBodies(eventId: number): string[]; read(sessionId?: string): StoredEvent[]; redact(eventId: number, reason: string): StoredEvent; verify(): { ok: true } | { ok: false; brokenAt: number }; close(): void }`

Schema:
- `events(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL, session_id TEXT NOT NULL, payload_json TEXT NOT NULL, hash TEXT NOT NULL, prev_hash TEXT NOT NULL)`
- `event_bodies(id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, text TEXT NOT NULL)`
- Triggers on `events` that do `UPDATE`/`DELETE` block with `RAISE(ABORT)`.

Hash: `sha256(prevHash + ts + kind + actor + sessionId + payload_json)` hex.

- [ ] **Step 1: Write the failing tests**

```ts
// test/store/events.test.ts
import { describe, it, expect } from 'vitest';
import { EventLog } from '../../server/store/events.js';

describe('EventLog', () => {
  it('appends in order and verifies the chain', () => {
    const log = new EventLog(':memory:');
    log.append('session_start', 'user', 's1', { cwd: '.' });
    log.append('message', 'user', 's1', { role: 'user' }, 'hello');
    expect(log.read('s1')).toHaveLength(2);
    expect(log.verify()).toEqual({ ok: true });
    log.close();
  });

  it('rejects direct UPDATE and DELETE', () => {
    const log = new EventLog(':memory:');
    const e = log.append('message', 'user', 's1', {}, 'x');
    expect(() => log.rawExec(`UPDATE events SET payload_json='{}' WHERE id=${e.id}`)).toThrow();
    expect(() => log.rawExec(`DELETE FROM events WHERE id=${e.id}`)).toThrow();
    log.close();
  });

  it('redaction deletes the body, keeps the event and does not break the chain', () => {
    const log = new EventLog(':memory:');
    const e = log.append('message', 'user', 's1', { role: 'user' });
    log.appendBody(e.id, 'secret text');
    log.redact(e.id, 'retention');
    expect(log.readBodies(e.id)).toEqual([]);
    expect(log.read('s1')[0]?.payload).toEqual({ role: 'user', redacted: true, reason: 'retention' });
    expect(log.verify()).toEqual({ ok: true });
    log.close();
  });
});
```

Note: `rawExec(sql: string): void` lives on the class for test help (direct `db.exec`).

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- test/store/events.test.ts`
Expected: FAIL — no module

- [ ] **Step 3: Write `events.ts`**

Steps: `new Database(path)`, `PRAGMA journal_mode = WAL` (skip for `:memory:`), schema + two triggers. `append` reads the previous `hash` with `SELECT hash FROM events ORDER BY id DESC LIMIT 1`, computes the hash, inserts the row. `redact` appends a **new** `redaction` event and deletes the target event's bodies; it does not touch the target row. So during `read`, redaction events are scanned and the affected events' `payload.redacted` field is marked at read time (no write). `verify` re-hashes every row in order and compares.

- [ ] **Step 4: Verify the tests pass**

Run: `npm test -- test/store/events.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/store test/store
git commit -m "feat: append-only event log with hash chain and redaction"
```

---

### Task 3: Read tools and output cap

**Files:**
- Create: `server/engine/tools/types.ts`
- Create: `server/engine/tools/fs-read.ts`
- Create: `server/engine/tools/index.ts`
- Test: `test/engine/tools-fs-read.test.ts`

**Interfaces:**
- Consumes: `ToolDef` (Task 1)
- Produces:
  - `ToolResult = { ok: boolean; output: string }`
  - `ToolContext = { cwd: string; signal: AbortSignal }`
  - `Tool = { def: ToolDef; access: 'read'|'write'|'exec'; run(args: Record<string,unknown>, ctx: ToolContext): Promise<ToolResult> }`
  - `MAX_OUTPUT = 32768`, `truncate(text: string, limit?: number): string` (both exported from `tools/index.ts`)
  - `readTools(cwd: string): Tool[]` — `read_file`, `list_dir`, `search`
  - `toolDefs(tools: Tool[]): ToolDef[]`
  - `resolveInside(cwd: string, path: string): string | null`

Tool inputs: `read_file {path, offset?, limit?}`; `list_dir {path?}`; `search {query, path?, maxResults?}`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/engine/tools-fs-read.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTools, truncate, MAX_OUTPUT } from '../../server/engine/tools/index.js';

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal });
const find = (cwd: string, name: string) => readTools(cwd).find((t) => t.def.name === name)!;

describe('read tools', () => {
  it('reads a file with a line range', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
    const r = await find(dir, 'read_file').run({ path: 'a.txt', offset: 2, limit: 1 }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(r.output).toBe('two');
  });

  it('rejects a path outside cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await find(dir, 'read_file').run({ path: '../../../etc/passwd' }, ctx(dir));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('outside cwd');
  });

  it('caps output and says it was truncated', async () => {
    expect(truncate('a'.repeat(MAX_OUTPUT + 10)).endsWith('…[truncated 10 bytes]')).toBe(true);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- test/engine/tools-fs-read.test.ts`
Expected: FAIL — no module

- [ ] **Step 3: Write `types.ts` and `fs-read.ts`**

Shared helper `resolveInside(cwd: string, path: string): string | null`: if the result of `path.resolve(cwd, path)` does not start with `cwd` it returns `null`; `..` and absolute paths are filtered out this way. For `search`, use `rg --line-number --max-count` when ripgrep exists, otherwise a simple recursive `node:fs` scan that skips large directories (`node_modules`, `.git`). Every tool caps its output with `truncate`.

- [ ] **Step 4: Verify the tests pass**

Run: `npm test -- test/engine/tools-fs-read.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/engine/tools test/engine/tools-fs-read.test.ts
git commit -m "feat: add read-only file tools with output cap"
```

---

### Task 4: Write tools and path guard

**Files:**
- Create: `server/engine/tools/fs-write.ts`
- Modify: `server/engine/tools/index.ts` (new `writeTools(cwd)` and `allTools(cwd)`)
- Test: `test/engine/tools-fs-write.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolContext`, `resolveInside` (Task 3)
- Produces:
  - `writeTools(cwd: string): Tool[]` — `write_file {path, content}`, `edit_file {path, oldString, newString, replaceAll?}`
  - `allTools(cwd: string): Tool[]` = `[...readTools(cwd), ...writeTools(cwd)]`
  - `edit_file` returns `ok:false` if there is no match or more than one match.

- [ ] **Step 1: Write the failing tests**

```ts
// test/engine/tools-fs-write.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTools } from '../../server/engine/tools/index.js';

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal });
const find = (cwd: string, name: string) => writeTools(cwd).find((t) => t.def.name === name)!;

describe('write tools', () => {
  it('writes a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await find(dir, 'write_file').run({ path: 'x.txt', content: 'hello' }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'x.txt'), 'utf8')).toBe('hello');
  });

  it('does not write outside cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await find(dir, 'write_file').run({ path: '../../escape.txt', content: 'x' }, ctx(dir));
    expect(r.ok).toBe(false);
  });

  it('edit refuses on multiple matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    await find(dir, 'write_file').run({ path: 'x.txt', content: 'aa\naa\n' }, ctx(dir));
    const r = await find(dir, 'edit_file').run({ path: 'x.txt', oldString: 'aa', newString: 'bb' }, ctx(dir));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('multiple');
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- test/engine/tools-fs-write.test.ts`
Expected: FAIL — no `writeTools`

- [ ] **Step 3: Write `fs-write.ts` and the `index.ts` update**

`write_file` creates the parent directory with `mkdir({recursive:true})`. `edit_file` also checks the symlink target with `resolveInside` + `stat` (the `realpath` result must be inside cwd). `access: 'write'`.

- [ ] **Step 4: Verify the tests pass**

Run: `npm test -- test/engine/tools-fs-write.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/engine/tools test/engine/tools-fs-write.test.ts
git commit -m "feat: add file write tools with cwd guard"
```

---

### Task 5: Command and network tools (timeout, process tree, abort)

**Files:**
- Create: `server/engine/tools/shell.ts`
- Create: `server/engine/tools/web.ts`
- Modify: `server/engine/tools/index.ts` (`allTools` returns these too)
- Test: `test/engine/tools-shell.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolContext`, `truncate`
- Produces:
  - `runCommandTool(cwd: string): Tool` — `run_command {command, timeoutMs?}`, `access:'exec'`
  - `fetchUrlTool(): Tool` — `fetch_url {url, method?, body?}`, `access:'exec'`
  - `DEFAULT_TIMEOUT_MS = 120_000`

Behaviour: on Windows kill the tree with `child_process.spawn` + `taskkill /pid <pid> /T /F`; on POSIX `detached:true` + `process.kill(-pid, 'SIGKILL')`. If `ctx.signal` is aborted the process is killed immediately and the result is `ok:false, output:'aborted'`. If the exit code is non-zero the result is `ok:false` but the output is preserved.

- [ ] **Step 1: Write the failing test**

```ts
// test/engine/tools-shell.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommandTool } from '../../server/engine/tools/shell.js';
import { allTools } from '../../server/engine/tools/index.js';

const ctx = (cwd: string, signal = new AbortController().signal) => ({ cwd, signal });

describe('run_command', () => {
  it('returns output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await runCommandTool(dir).run({ command: 'node -e "console.log(21*2)"' }, ctx(dir));
    expect(r.ok).toBe(true);
    expect(r.output.trim()).toBe('42');
  });

  it('kills on timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const r = await runCommandTool(dir).run({ command: 'node -e "setTimeout(()=>{},60000)"', timeoutMs: 300 }, ctx(dir));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('timeout');
  });

  it('command does not run after abort', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const ac = new AbortController();
    ac.abort();
    const r = await runCommandTool(dir).run({ command: 'node -e "console.log(1)"' }, ctx(dir, ac.signal));
    expect(r.ok).toBe(false);
    expect(r.output).toBe('aborted');
  });

  it('allTools includes exec tools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'karen-'));
    const names = allTools(dir).map((t) => t.def.name);
    expect(names).toContain('run_command');
    expect(names).toContain('fetch_url');
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- test/engine/tools-shell.test.ts`
Expected: FAIL — no module

- [ ] **Step 3: Write `shell.ts`, `web.ts` and the `index.ts` update**

`web.ts`: `fetch` with a 20 s timeout, 32 KiB body cap, `http/https` schemes only, `method` defaults to `GET`. `fetch_url` gets `access:'exec'` because it sends data to the network (the permission layer will count it as `important`).

- [ ] **Step 4: Verify the tests pass**

Run: `npm test -- test/engine/tools-shell.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/engine/tools test/engine/tools-shell.test.ts
git commit -m "feat: add command and fetch tools with timeout and abort"
```

---

### Task 6: Permission classifier and approver

**Files:**
- Create: `server/engine/permissions.ts`
- Test: `test/engine/permissions.test.ts`

**Interfaces:**
- Consumes: `Tool` (the `access` field)
- Produces:
  - `PermissionClass = 'simple' | 'important'`
  - `PermissionRequest = { tool: string; access: 'read'|'write'|'exec'; args: Record<string,unknown>; cwd: string }`
  - `classify(req: PermissionRequest): { class: PermissionClass; reason: string }`
  - `Approver = { ask(req: PermissionRequest): Promise<boolean> }`
  - `autoApprover(): Approver` — always `true` (tests)
  - `denyApprover(): Approver` — always `false`

Classification rules (deterministic, in order):
1. `access==='read'` → simple.
2. `access==='write'`: if the target path `resolveInside(cwd, path)` is `null` it is important (`outside cwd`), otherwise simple.
3. `access==='exec'` and tool `fetch_url` → important (`network`).
4. `access==='exec'` and tool `run_command`: split the command text on spaces; if the first word is in `SAFE_COMMANDS` **and** no `DANGEROUS_PATTERNS` match, simple; otherwise important.
   - `SAFE_COMMANDS`: `node,npm,npx,pnpm,yarn,tsc,vitest,git,ls,dir,cat,type,echo,rg,find,python,pip,cargo,go,dotnet,mkdir,cp,mv,touch,curl`
   - `DANGEROUS_PATTERNS`: `/\brm\b/i`, `/\bdel\b/i`, `/rmdir|\brd\b/i`, `/reset --hard/i`, `/push --force|push -f/i`, `/--no-verify/i`, `/format\b/i`, `/\breg\b/i`, `/\bnetsh\b/i`, `/\bschtasks\b/i`, `/\bshutdown\b/i`, `/\bpublish\b/i`, `/\|\s*(bash|sh|powershell|pwsh)\b/i`, `/>\s*[A-Za-z]:\\/`
5. `curl` on its own counts as safe (download); `curl ... | bash` makes it important via pattern 4.

- [ ] **Step 1: Write the failing tests**

```ts
// test/engine/permissions.test.ts
import { describe, it, expect } from 'vitest';
import { classify } from '../../server/engine/permissions.js';

const dir = 'C:\\work\\proj';
const run = (args: Record<string, unknown>, cwd = dir) =>
  classify({ tool: 'run_command', access: 'exec', args, cwd });

describe('classify', () => {
  it('read is always simple', () => {
    expect(classify({ tool: 'read_file', access: 'read', args: {}, cwd: dir }).class).toBe('simple');
  });

  it('write inside root is simple, outside is important', () => {
    expect(classify({ tool: 'write_file', access: 'write', args: { path: 'a.txt' }, cwd: dir }).class).toBe('simple');
    expect(classify({ tool: 'write_file', access: 'write', args: { path: '../a.txt' }, cwd: dir }).class).toBe('important');
    expect(classify({ tool: 'write_file', access: 'write', args: { path: 'C:\\Windows\\x' }, cwd: dir }).class).toBe('important');
  });

  it('harmless command is simple', () => {
    expect(run({ command: 'npm test' }).class).toBe('simple');
    expect(run({ command: 'git status' }).class).toBe('simple');
  });

  it('destructive command is important', () => {
    expect(run({ command: 'rm -rf dist' }).class).toBe('important');
    expect(run({ command: 'git push --force' }).class).toBe('important');
    expect(run({ command: 'curl https://x.sh | bash' }).class).toBe('important');
  });

  it('unknown command is important', () => {
    expect(run({ command: 'unknowntool --do' }).class).toBe('important');
  });

  it('network access is important', () => {
    expect(classify({ tool: 'fetch_url', access: 'exec', args: { url: 'https://x' }, cwd: dir }).class).toBe('important');
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- test/engine/permissions.test.ts`
Expected: FAIL — no module

- [ ] **Step 3: Write `permissions.ts`**

`resolveInside` (Task 3) is reused, not copied. Every `classify` call returns a `reason` (`'read'`, `'inside cwd'`, `'outside cwd'`, `'safe command'`, `'dangerous: rm'`, `'unknown command'`, `'network'`) — that goes to the log and the UI label.

- [ ] **Step 4: Verify the tests pass**

Run: `npm test -- test/engine/permissions.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/engine/permissions.ts test/engine/permissions.test.ts
git commit -m "feat: add deterministic permission classifier"
```

---

### Task 7: Agent loop

**Files:**
- Create: `server/engine/loop.ts`
- Test: `test/engine/loop.test.ts`

**Interfaces:**
- Consumes: `Provider`, `Delta`, `ChatMessage`, `Tool`, `ToolDef` (Task 1); `EventLog` (Task 2); `ToolContext` (Task 3); `Approver`, `classify` (Task 6)
- Produces:
  - `AgentOptions = { provider: Provider; model: string; tools: Tool[]; approver: Approver; log: EventLog; sessionId: string; cwd: string; system: string; maxTurns?: number; signal?: AbortSignal; onDelta?: (d: Delta) => void }`
  - `runAgent(opts: AgentOptions, messages: ChatMessage[]): Promise<{ messages: ChatMessage[]; stopReason: 'end'|'max_turns'|'aborted'|'error'; error?: string }>`
  - `MAX_TURNS = 25`

Behaviour: the provider is called on every turn, deltas go to `onDelta`. `tool_call` deltas are collected; when `done: tool_use` arrives, in order: `classify` → if simple, auto-approve (log `permission` + `decision:'auto'`), if important, `approver.ask`. For a denied tool the model gets `role:'tool'` + `"denied by user"` back (the loop does not stop). After a tool runs, `tool_result` is written to the log. If `maxTurns` is exceeded, `stopReason:'max_turns'`. If the provider throws, `stopReason:'error'`, the error message is returned and `error` is written to the log; **half tool calls collected in that turn are not run**.

- [ ] **Step 1: Write the failing tests**

```ts
// test/engine/loop.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../../server/engine/loop.js';
import { FakeProvider } from '../../server/engine/providers/fake.js';
import { EventLog } from '../../server/store/events.js';
import { allTools } from '../../server/engine/tools/index.js';
import { autoApprover, denyApprover } from '../../server/engine/permissions.js';

const setup = (script: ConstructorParameters<typeof FakeProvider>[0]) => {
  const cwd = mkdtempSync(join(tmpdir(), 'karen-'));
  const log = new EventLog(':memory:');
  const provider = new FakeProvider(script);
  return { cwd, log, provider };
};

describe('runAgent', () => {
  it('streams text and finishes', async () => {
    const { cwd, log, provider } = setup([[{ type: 'text', text: 'hi' }, { type: 'done', stopReason: 'end' }]]);
    const text: string[] = [];
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver: autoApprover(), log, sessionId: 's', cwd, system: 'sys', onDelta: (d) => { if (d.type === 'text') text.push(d.text); } },
      [{ role: 'user', content: 'hello' }],
    );
    expect(text).toEqual(['hi']);
    expect(r.stopReason).toBe('end');
    log.close();
  });

  it('auto-approves and runs a simple tool call', async () => {
    const { cwd, log, provider } = setup([
      [{ type: 'tool_call', call: { id: 'c1', name: 'run_command', args: { command: 'node -e "console.log(7)"' } } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end' }],
    ]);
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver: denyApprover(), log, sessionId: 's', cwd, system: 'sys' },
      [{ role: 'user', content: 'run' }],
    );
    expect(r.stopReason).toBe('end');
    expect(r.messages.some((m) => m.role === 'tool' && m.content.includes('7'))).toBe(true);
    expect(log.read('s').some((e) => e.kind === 'permission' && e.payload['decision'] === 'auto')).toBe(true);
    log.close();
  });

  it('an important tool call does not run when denied', async () => {
    const { cwd, log, provider } = setup([
      [{ type: 'tool_call', call: { id: 'c1', name: 'run_command', args: { command: 'rm -rf /' } } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'done', stopReason: 'end' }],
    ]);
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver: denyApprover(), log, sessionId: 's', cwd, system: 'sys' },
      [{ role: 'user', content: 'delete' }],
    );
    expect(r.messages.some((m) => m.role === 'tool' && m.content === 'denied by user')).toBe(true);
    log.close();
  });

  it('an error mid-stream does not run a half tool call', async () => {
    const { cwd, log } = setup([]);
    const provider = {
      name: 'boom',
      async *stream() {
        yield { type: 'tool_call' as const, call: { id: 'c1', name: 'run_command', args: { command: 'node -e "console.log(1)"' } } };
        throw new Error('connection lost');
      },
    };
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver: autoApprover(), log, sessionId: 's', cwd, system: 'sys' },
      [{ role: 'user', content: 'x' }],
    );
    expect(r.stopReason).toBe('error');
    expect(r.messages.some((m) => m.role === 'tool')).toBe(false);
    expect(log.read('s').some((e) => e.kind === 'error')).toBe(true);
    log.close();
  });

  it('tool does not run when aborted while awaiting approval', async () => {
    const { cwd, log, provider } = setup([
      [{ type: 'tool_call', call: { id: 'c1', name: 'run_command', args: { command: 'rm -rf dist' } } }, { type: 'done', stopReason: 'tool_use' }],
    ]);
    const ac = new AbortController();
    const approver = { ask: async () => { ac.abort(); return true; } };
    const r = await runAgent(
      { provider, model: 'm', tools: allTools(cwd), approver, log, sessionId: 's', cwd, system: 'sys', signal: ac.signal },
      [{ role: 'user', content: 'delete' }],
    );
    expect(r.stopReason).toBe('aborted');
    expect(r.messages.some((m) => m.role === 'tool')).toBe(false);
    log.close();
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- test/engine/loop.test.ts`
Expected: FAIL — no module

- [ ] **Step 3: Write `loop.ts`**

Flow: loop over a copy of `messages`. Each turn the `assistant` message is assembled from the stream. If `stopReason==='end'`, exit. On error `log.append('error', ...)` and return. `signal.aborted` is checked at the start of every turn **and after returning from approval, before running the tool** (`stopReason:'aborted'`); that way work cancelled while awaiting approval never executes.

- [ ] **Step 4: Verify the tests pass**

Run: `npm test -- test/engine/loop.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/engine/loop.ts test/engine/loop.test.ts
git commit -m "feat: add agent loop with permission gate and event logging"
```

---

### Task 8: Context trimming

**Files:**
- Create: `server/engine/history.ts`
- Test: `test/engine/history.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`
- Produces:
  - `trimHistory(messages: ChatMessage[], maxChars = 200_000): ChatMessage[]` — always keeps the system message, drops starting from the oldest, and adds a single `assistant` note for the dropped turns: `"[previous N messages trimmed]"`. Tool messages are never left without their parent assistant message.

Note (Phase 1 limit): summarisation with an LLM comes in Phase 3; for now, deterministic trimming.
`shortcut: no summarisation, trimming only — change when summarisation lands for overflowing context.`

- [ ] **Step 1: Write the failing test**

```ts
// test/engine/history.test.ts
import { describe, it, expect } from 'vitest';
import { trimHistory } from '../../server/engine/history.js';

describe('trimHistory', () => {
  it('keeps the system message and the last turn', () => {
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'a'.repeat(100) },
      { role: 'assistant' as const, content: 'b'.repeat(100) },
      { role: 'user' as const, content: 'last' },
    ];
    const out = trimHistory(msgs, 150);
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out.at(-1)).toEqual({ role: 'user', content: 'last' });
    expect(out.some((m) => m.content.includes('trimmed'))).toBe(false);
  });

  it('drops old turns and notes it when the budget is exceeded', () => {
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'a'.repeat(1000) },
      { role: 'assistant' as const, content: 'b'.repeat(1000) },
      { role: 'user' as const, content: 'new' },
      { role: 'assistant' as const, content: 'reply' },
    ];
    const out = trimHistory(msgs, 500);
    expect(out[0]?.role).toBe('system');
    expect(out.some((m) => m.content.startsWith('[previous'))).toBe(true);
    expect(out.at(-1)?.content).toBe('reply');
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- test/engine/history.test.ts`
Expected: FAIL — no module

- [ ] **Step 3: Write `history.ts`**

It works on a character total; it adds from the end to the start, stops when the budget is full, and writes the remaining count into the note.

- [ ] **Step 4: Verify the test passes**

Run: `npm test -- test/engine/history.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/engine/history.ts test/engine/history.test.ts
git commit -m "feat: add deterministic history trimming"
```

---

### Task 9: Real provider adapters (tested with fixtures)

**Files:**
- Create: `server/engine/providers/sse.ts`
- Create: `server/engine/providers/anthropic.ts`
- Create: `server/engine/providers/openai-compatible.ts`
- Create: `test/fixtures/anthropic-stream.txt`, `test/fixtures/openai-stream.txt`
- Test: `test/engine/providers.test.ts`
- Modify: `server/engine/providers/index.ts` (new) — `createProvider(id: string, env: NodeJS.ProcessEnv): Provider` (`anthropic`, `openai`, `ollama`, `lmstudio`)

**Interfaces:**
- Consumes: `Provider`, `StreamRequest`, `Delta`
- Produces:
  - `parseSSE(chunks: AsyncIterable<string>): AsyncIterable<{ event?: string; data: string }>`
  - `AnthropicProvider = { name:'anthropic'; constructor(opts:{apiKey:string; baseUrl?:string; fetchImpl?: typeof fetch}); stream(req: StreamRequest): AsyncIterable<Delta> }`
  - `OpenAICompatibleProvider = { name:string; constructor(opts:{baseUrl:string; apiKey?:string; fetchImpl?: typeof fetch}); stream(req: StreamRequest): AsyncIterable<Delta> }`
  - `createProvider(id: string, env: NodeJS.ProcessEnv): Provider` — `anthropic` → `ANTHROPIC_API_KEY`; `openai` → `OPENAI_API_KEY` + `https://api.openai.com/v1`; `ollama` → `http://127.0.0.1:11434/v1`; `lmstudio` → `http://127.0.0.1:1234/v1`. If the key is missing, `throw new Error('missing API key: ...')`.

Injecting `fetchImpl` is what keeps the test off the network.

- [ ] **Step 1: Write the fixtures**

`test/fixtures/anthropic-stream.txt` (lines):
```
event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":12}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"read_file","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"a.txt\"}"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}

event: message_stop
data: {"type":"message_stop"}
```

`test/fixtures/openai-stream.txt`:
```
data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":""}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":\"a.txt\"}"}}]}}]}

data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}

data: [DONE]
```

- [ ] **Step 2: Write the failing tests**

```ts
// test/engine/providers.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AnthropicProvider } from '../../server/engine/providers/anthropic.js';
import { OpenAICompatibleProvider } from '../../server/engine/providers/openai-compatible.js';
import { createProvider } from '../../server/engine/providers/index.js';

const body = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const fakeFetch = (text: string): typeof fetch =>
  (async () => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;

const collect = async (p: { stream: (r: any) => AsyncIterable<any> }) => {
  const out: any[] = [];
  for await (const d of p.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [] })) out.push(d);
  return out;
};

describe('anthropic adapter', () => {
  it('translates text, tool call and usage info', async () => {
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: fakeFetch(body('anthropic-stream.txt')) });
    const out = await collect(p);
    expect(out[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(out.find((d) => d.type === 'tool_call')).toEqual({ type: 'tool_call', call: { id: 'tu_1', name: 'read_file', args: { path: 'a.txt' } } });
    expect(out.find((d) => d.type === 'usage')).toEqual({ type: 'usage', inputTokens: 12, outputTokens: 7 });
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });
});

describe('openai-compatible adapter', () => {
  it('joins tool call arguments', async () => {
    const p = new OpenAICompatibleProvider({ baseUrl: 'http://local/v1', fetchImpl: fakeFetch(body('openai-stream.txt')) });
    const out = await collect(p);
    expect(out.find((d) => d.type === 'tool_call')).toEqual({ type: 'tool_call', call: { id: 'call_1', name: 'read_file', args: { path: 'a.txt' } } });
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });
});

describe('createProvider', () => {
  it('throws clearly when the key is missing', () => {
    expect(() => createProvider('anthropic', {})).toThrow('missing API key: ANTHROPIC_API_KEY');
  });
  it('builds a local provider without a key', () => {
    expect(createProvider('ollama', {}).name).toBe('ollama');
  });
});
```

- [ ] **Step 3: Verify the tests fail**

Run: `npm test -- test/engine/providers.test.ts`
Expected: FAIL — no module

- [ ] **Step 4: Write the adapters**

`parseSSE`: `TextDecoder` + buffer; splits on `\n\n`; joins `data:` lines, carries the `event:` field. Anthropic: accumulate `input_json_delta` fragments per index, `JSON.parse` them at `content_block_stop` or `message_delta` and emit `tool_call`; `stop_reason` mapping `end_turn→end`, `tool_use→tool_use`, `max_tokens→max_tokens`. OpenAI-compatible: accumulate `arguments` per `tool_calls[].index`, emit at `finish_reason==='tool_calls'`; `[DONE]` ends the stream. Each adapter, on an HTTP error (`!res.ok`), truncates the body and throws an `Error`.

- [ ] **Step 5: Verify the tests pass**

Run: `npm test -- test/engine/providers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add server/engine/providers test/engine/providers.test.ts test/fixtures
git commit -m "feat: add anthropic and openai-compatible streaming adapters"
```

---

### Task 10: CLI entrypoint and end-to-end smoke test

**Files:**
- Create: `server/cli.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: everything
- Produces:
  - `main(argv: string[], deps?: { provider?: Provider; cwd?: string; logPath?: string; readline?: (q: string) => Promise<string> }): Promise<number>`
  - Usage: `npm run karen -- run "<task>" --cwd <dir> --provider <id> --model <name>`
  - `deps.readline` is injectable; defaults to `node:readline/promises`.
  - Exit code: 0 success, 1 error.

Behaviour: if `--log <path>` is not given, `.karen/events.db`. `session_start` is written, `runAgent` runs, deltas stream to stdout, important approval requests are asked as `[approval] <tool>: <command> (reason) — approve? (y/n)`, and `session_end` is written.

- [ ] **Step 1: Write the failing test**

```ts
// test/cli.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../server/cli.js';
import { FakeProvider } from '../server/engine/providers/fake.js';

describe('cli', () => {
  it('runs the task and closes the session', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'karen-'));
    const logPath = join(cwd, 'events.db');
    const provider = new FakeProvider([[{ type: 'text', text: 'ok' }, { type: 'done', stopReason: 'end' }]]);
    const code = await main(['run', 'hello', '--cwd', cwd, '--log', logPath], { provider, cwd, readline: async () => 'y' });
    expect(code).toBe(0);
  });

  it('returns 1 on a provider error', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'karen-'));
    const provider = { name: 'boom', async *stream() { throw new Error('none'); } };
    const code = await main(['run', 'x', '--cwd', cwd, '--log', join(cwd, 'e.db')], { provider, cwd, readline: async () => 'y' });
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- test/cli.test.ts`
Expected: FAIL — no module

- [ ] **Step 3: Write `cli.ts`**

Argument parsing with `node:util` `parseArgs`. If `deps.provider` is missing, `createProvider(id, process.env)`. For now the system text comes from a short string rather than a fixed file: `"You are KAREN. Work briefly and clearly. Use tools appropriately for the goal."` (identity files in Phase 3).

- [ ] **Step 4: Verify the test passes**

Run: `npm test -- test/cli.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS — all files

- [ ] **Step 6: Commit**

```bash
git add server/cli.ts test/cli.test.ts
git commit -m "feat: add karen CLI entrypoint"
```

---

## Phase 1 Completion Check

- [ ] `npm test` all pass.
- [ ] `npm run build` clean.
- [ ] Manual: `ANTHROPIC_API_KEY=... npm run karen -- run "count how many .ts files are in this folder" --provider anthropic --model <model>` → calls tools and answers.
- [ ] Manual: when a command containing `rm -rf` is requested an approval question appears; answering `n` means the command does not run.
- [ ] `.karen/events.db` can be opened and the events read; `log.verify()` verifies them.

## Deliberately not done in Phase 1

Server/WebSocket, UI, memory layers, distillation, session orchestration, skill library, map. Those are Phase 2, 2b, 3, 4, 5 respectively.

Also the **Google adapter** is deferred: the spec counts four adapters, Phase 1 works with anthropic and openai-compatible. Google does not offer an OpenAI-compatible endpoint so it needs its own adapter; it will be added at the start of Phase 2 as the second real provider (without changing the engine interface).
