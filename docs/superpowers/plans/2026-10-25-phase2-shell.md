# KAREN Phase 2 — Shell + Chat Application Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine usable from the browser: full-screen brain chat, live feed, inline approval cards, bottom session menu and repo buttons.

**Architecture:** A single Node process serves HTTP + WebSocket (`server/http/`), calling the engine from `server/engine`. `SessionManager` holds sessions (one agent loop per task), `ApprovalBroker` asks the user for approval requests over WS. The UI lives under `app/` with Vite + React; a single page, talks over WS, keeps state with `useReducer`.

**Tech Stack:** Node ≥20, TypeScript ESM, `ws`, React 18, Vite 5, vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-ikinci-beyin-ide-design.md` (§7.2 approval authority, §7.9 orchestration, §7.11 repo buttons, §8 UI)

## Global Constraints

- The server listens only on `127.0.0.1`; every request checks `Origin` and validates a single-use token (`?token=`).
- WS messages are JSON; an unknown `type` is silently ignored and the connection does not drop.
- Approval request timeout 5 min → reject.
- One active request per session; a second message is not queued, an error is returned.
- `repos.json` in the user folder (`~/.karen/repos.json`); writes are atomic (temp + rename).
- No API key or secret is shown in the UI.
- Tests do not go to the network (loopback allowed, provider faked).

## Review Focus

1. A `sessionId` arriving over WS must not be able to resolve another session's approval.
2. When a session waiting for approval is cancelled, the request must be rejected and cleaned up (no leaked promise).
3. A page whose `Origin` does not match must not be able to connect to the server; without a token `/api/*` must return 401.
4. If the browser closes mid-stream, the session must not stay "running" forever.
5. If `repos.json` is corrupt/missing the server must still start and return an empty list (must not crash).

---

### Task 1: Repo registry

**Files:** Create `server/repos.ts`, `test/repos.test.ts`

**Interfaces:**
- Produces: `Repo = { id: string; name: string; path: string }`, `class RepoStore { constructor(filePath: string); list(): Repo[]; add(path: string, name?: string): Repo; remove(id: string): boolean }`
- `add` does not add the same path twice (returns the existing record). `id` = first 8 characters of the path's sha1.

- [ ] Test: corrupt file → empty list; add/list/remove; adding the same path twice yields a single record.
- [ ] Test red.
- [ ] Write `repos.ts` (atomic write: `file.tmp` + `rename`).
- [ ] Test green. Commit.

### Task 2: ApprovalBroker

**Files:** Create `server/http/approvals.ts`, `test/approvals.test.ts`

**Interfaces:**
- Produces: `class ApprovalBroker { ask(sessionId: string, req: PermissionRequest, notify: (m: ApprovalRequestMsg) => void, signal?: AbortSignal): Promise<boolean>; resolve(sessionId: string, requestId: string, allow: boolean): boolean; cancelSession(sessionId: string): void; pending(sessionId?: string): ApprovalRequestMsg[] }`
- `ApprovalRequestMsg = { type:'approval_request'; sessionId:string; requestId:string; tool:string; args:Record<string,unknown>; reason:string; className:'simple'|'important' }`
- `resolve` returns `true` only for a matching `sessionId`+`requestId`; it does not resolve someone else's request.
- Timeout (`timeoutMs` parameter, default 300000) → `false`; abort → `false` and the request is removed from the queue.

- [ ] Test: resolve returns true; another session's requestId returns false and the request is not resolved; timeout false; abort false.
- [ ] Test red → implement → green. Commit.

### Task 3: SessionManager

**Files:** Create `server/sessions.ts`, `test/sessions.test.ts`

**Interfaces:**
- Produces:
  - `SessionInfo = { id:string; title:string; cwd:string; status:'idle'|'running'|'error'; createdAt:number; lastMessage?:string }`
  - `class SessionManager { constructor(deps:{ provider:Provider; model:string; log:EventLog; approve:(sessionId:string, req:PermissionRequest, signal?:AbortSignal)=>Promise<boolean>; cwdDefault?:string; onEvent:(e:ServerEvent)=>void }); create(opts:{cwd?:string; title?:string}): SessionInfo; list(): SessionInfo[]; get(id:string): SessionInfo|undefined; history(id:string): ChatMessage[]; send(id:string, text:string): Promise<{ok:boolean; error?:string}>; abort(id:string): void }`
  - `ServerEvent = {type:'delta';sessionId:string;delta:Delta} | {type:'status';sessionId:string;status:SessionInfo['status']} | {type:'done';sessionId:string;stopReason:string} | {type:'error';sessionId:string;message:string}`
- `send` returns `{ok:false,error:'busy'}` on a running session. `create` default title: `Session N`.

- [ ] Test: create/list; send a message → delta and done to onEvent; second concurrent message `busy`; abort → `done` + idle.
- [ ] Test red → implement → green. Commit.

### Task 4: HTTP + WS server

**Files:** Create `server/http/server.ts`, `server/http/protocol.ts`, `test/http.test.ts`

**Interfaces:**
- Produces: `createKarenServer(opts:{ repos:RepoStore; sessions:SessionManager; approvals:ApprovalBroker; token:string; rootDir?:string }): { listen(port?:number): Promise<{port:number; url:string; token:string}>; close(): Promise<void> }`
- REST: `GET /api/repos`, `POST /api/repos {path,name?}`, `DELETE /api/repos/:id`, `GET /api/sessions`, `POST /api/sessions {cwd,title}`, `GET /api/health`.
- WS `/ws?token=…`: client → `{type:'message',sessionId,text}`, `{type:'approval',sessionId,requestId,allow}`, `{type:'abort',sessionId}`, `{type:'open',sessionId}`.
- Server → `ServerEvent` + `{type:'history',sessionId,messages}` + `approval_request`.
- Static: `app/dist` is served if present (otherwise `GET /` 200 + "KAREN server running").

- [ ] Test: no token → 401; wrong Origin → WS rejected; add/list repos; open a session + message → delta received; another session's approval rejected.
- [ ] Test red → implement → green. Commit.

### Task 5: UI skeleton (Vite + React)

**Files:** Create `app/index.html`, `app/vite.config.ts`, `app/tsconfig.json`, `app/src/main.tsx`, `app/src/App.tsx`, `app/src/api.ts`, `app/src/state.ts`, `app/src/styles.css`, `app/src/components/{Chat,BottomBar,SessionMenu,RepoGrid,ApprovalCard}.tsx`, `test/app-state.test.ts`

**Interfaces:**
- Produces (state, pure functions — testable): `initialState`, `reduce(state, action)`; actions `{type:'delta'|'done'|'approval'|'sessions'|'repos'|'status'|'user'|'clearApproval'}`.
- `api.ts`: `bootstrap(): Promise<{token:string}>` (from the URL `?token=`), `getJson/postJson`, `openSocket(onEvent)`.
- View: full-screen message list; at the bottom `[sessions ▾] [repos] [settings]`; the approval card in the message feed; a badge in the bottom bar when an approval is pending.

- [ ] Test: `reduce` appends a delta; done sets status to idle; approval is added; clearApproval removes it.
- [ ] Test red → write the components and reducer → green.
- [ ] `npm run build` (vite) without errors. Commit.

### Task 6: `serve` for the CLI

**Files:** Modify `server/cli.ts`, `test/cli-serve.test.ts`

**Interfaces:** `npm run karen -- serve [--port 7331]` → generates a token, prints the URL, waits until the server closes.

- [ ] Test: start `serve`, `GET /api/health` 200, close.
- [ ] Test red → implement → green. Commit.

## Phase 2 Completion Check

- [ ] `npm test` all pass, `npm run build` (tsc + vite) clean.
- [ ] Manual: `npm run karen -- serve` → chat in the browser, message streaming, approval card, session menu.
- [ ] A command containing `rm -rf` lands in the approval card; rejecting it means it does not run.

## Deliberately not done in Phase 2

Memory/distillation (Phase 3), background sessions (Phase 4), map (Phase 5), the repo button saying "brain, work in this repo" (Phase 4), skill library (Phase 2b).
