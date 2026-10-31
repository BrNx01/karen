# KAREN 1.1 — Experience Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship KAREN 1.1.0: an arc-reactor icon, a calm rail/stage/context shell, a real Settings control room, one-address provider detection with model listing, offline Piper speech installed on first run, and direct computer control — then a README and landing page with real screenshots.

**Architecture:** The React app keeps its screens and data flow; a new shell component (`AppShell`) replaces the current top-bar/sidebar frame and hosts them. Server work adds three independent surfaces (provider probe, voice engine, computer-control tools) behind existing HTTP routes and the existing permission gate. `ChatMessage.content` widens from `string` to `string | ContentBlock[]` so a screenshot can reach a vision model.

**Tech Stack:** TypeScript (strict, ESM), Node 20+, React 18 + Vite, better-sqlite3, vitest, Electron 33, PowerShell (P/Invoke via `Add-Type`), Piper (downloaded at runtime).

**Spec:** `docs/superpowers/specs/2026-10-31-karen-v2-experience-design.md`

## Global Constraints

- **No new runtime dependency.** `dependencies` in `package.json` must not grow. A devDependency is allowed only if it cannot reach the shipped bundle.
- **Never write a file with PowerShell `Get-Content`/`Set-Content`** — it corrupts Turkish UTF-8. Use `edit`/`write`, or Node `fs`.
- Server stays bound to `127.0.0.1`, requires the token, checks Origin.
- No computer action reaches the OS without a permission decision and an audit event.
- Turkish **data** is not translated: `server/brain/stopwords.ts`, `CRISIS`/`NEW_PROJECT` regexes, `server/memory/world.ts` patterns/units, fold chains, `tr-TR` speech defaults.
- UI text comes only from `shared/i18n/{en,tr}.ts`; every key must exist in both, with identical placeholders.
- Every behaviour added gets a test. `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p app/tsconfig.json --noEmit` and `npx vitest run` must be green at every commit.
- No emoji in `app/src`; no gradient or shadow outside the core orb.
- Windows is the shipped target; the server must still run as plain Node on any OS.
- Palette from the spec: `--bg #08080a`, `--surface #0e0e12`, `--panel #14141a`, `--raised #1b1b22`, `--line #241016`, `--text #ececef`, `--muted #8f8f99`, `--faint #5a5a63`, `--accent #e11d2e`, `--accent-soft #ff5a66`, `--ok #5dd1a4`, `--warn #ffc25c`, `--data #6ea8fe` (charts only).
- The React app has **no jsdom** and no testing-library. UI assertions are source-level (like `test/theme.test.ts`) or against pure helpers; anything interactive is verified by the screenshot step in Task 15.

## Review Focus

| Input or condition | Expected behaviour | Pinned by |
|---|---|---|
| Multi-monitor at 125 %/150 % DPI | the cursor lands on the pixel the model named, on the monitor it named | T11 |
| An endpoint that answers 200 with HTML instead of JSON | the probe shows a readable error, never a crash or an empty model list | T6 |
| `type_text` with Turkish characters (`ğüşıöç`) | the text arrives intact, not as `?` or key codes | T11 |
| A chat history containing an image block, trimmed under budget | the system prompt and the image survive trimming; no `[object Object]` reaches a provider | T8 |
| Piper binary missing, or killed mid-synthesis | the reply still completes; speech falls back and says so once | T9 |

---

## Task 1: Palette tokens and the icon set

**Files:**
- Modify: `app/src/styles.css` (`:root` block only), `app/src/components/CommandCenter.tsx` (nav icons)
- Create: `app/src/icons.tsx`
- Test: `test/theme.test.ts` (extend), `test/icons.test.ts`

**Interfaces:**
- Produces: `export type IconName = 'nav.overview' | 'nav.chat' | 'nav.inbox' | 'nav.memory' | 'nav.map' | 'nav.skills' | 'nav.growth' | 'nav.repos' | 'nav.settings' | 'action.send' | 'action.mic' | 'action.stop' | 'action.copy' | 'action.refresh' | 'action.approve' | 'action.reject' | 'status.online' | 'status.offline' | 'status.thinking' | 'status.done' | 'status.warning' | 'status.error' | 'misc.settings' | 'misc.palette' | 'misc.chevron'`; `export function Icon(props: { name: IconName; size?: number; className?: string }): JSX.Element`.
- Produces: CSS custom properties `--surface`, `--raised`, `--faint`, `--data` alongside the existing ones.

- [ ] **Step 1: Extend `test/theme.test.ts`**

Add assertions: every token from Global Constraints appears in the `:root` block; `--data` appears **only** in a `chart`-prefixed selector (assert its occurrences are ≤ 2); no `linear-gradient` outside `.orb`; no `--data` usage in `command.css`/`polish.css`.

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run test/theme.test.ts` → FAIL, missing `--surface`.

- [ ] **Step 3: Replace the `:root` block** in `app/src/styles.css` with the Global Constraints palette, then sweep the three stylesheets so every hard-coded hex is a token or a value from the existing allowed set (the `stays inside the palette` test in `theme.test.ts` is the gate).

- [ ] **Step 4: Write `test/icons.test.ts`**

Assert: `Object.keys` of the exported map has 25 entries; each component renders with `stroke="currentColor"` and `fill="none"`; `app/src` contains no character in `/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u`.

- [ ] **Step 5: Implement `app/src/icons.tsx`** — one `PATHS: Record<IconName, string>` (20×20 viewBox, stroke 1.5, round caps) and one `Icon` component. No `<img>`, no external files.

- [ ] **Step 6: Use it** — `CommandCenter.tsx` NAV `icon` fields become `IconName`; the emoji strings disappear.

- [ ] **Step 7: Verify and commit**

Run: `npx tsc -p app/tsconfig.json --noEmit && npx vitest run test/theme.test.ts test/icons.test.ts`
```bash
git add app/src/styles.css app/src/icons.tsx app/src/components/CommandCenter.tsx test/theme.test.ts test/icons.test.ts
git commit -m "feat(ui): new palette tokens and a hand-drawn icon set"
```

---

## Task 2: Arc-reactor app icon

**Files:**
- Create: `scripts/make-icon.mjs`, `site/assets/karen-mark.svg`
- Modify: `electron/icon.png` (512×512, regenerated), `app/index.html` (favicon), `site/index.html` (favicon + hero mark)
- Test: `test/brand-assets.test.ts`

**Interfaces:**
- Produces: `scripts/make-icon.mjs` writing `electron/icon.png` (512×512 RGBA) and `site/assets/karen-mark.svg` from one geometry description; `npm run icon` script.

- [ ] **Step 1: Write `test/brand-assets.test.ts`**

Assert: `electron/icon.png` starts with the PNG signature and its IHDR reads 512×512; the SVG contains three `<circle>` rings and one `<path>` coil with `stroke="#e11d2e"`; both files are < 200 KB; `app/index.html` and `site/index.html` reference a mark.

- [ ] **Step 2: Run — expect failure** (size 256, no SVG).

- [ ] **Step 3: Implement `scripts/make-icon.mjs`** — reuse the zlib/CRC PNG writer already proven in the 1.0.0 icon, draw at 512: rounded black tile, outer thin ring at r=210, mid ring r=168, segmented coil (24 short arcs) at r=140, core disc r=44 with a soft two-stop radial, no text.

- [ ] **Step 4: Generate, wire the favicon and hero mark, add `"icon": "node scripts/make-icon.mjs"` to `package.json` scripts.**

- [ ] **Step 5: Verify and commit**

Run: `npm run icon && npx vitest run test/brand-assets.test.ts && npx electron-builder --win --dir --publish never` (expect `release/win-unpacked/KAREN.exe` and no "default Electron icon" warning).
```bash
git add scripts/make-icon.mjs electron/icon.png site/assets/karen-mark.svg site/index.html app/index.html package.json test/brand-assets.test.ts
git commit -m "feat(brand): arc-reactor icon generated from one geometry source"
```

---

## Task 3: The shell

**Files:**
- Create: `app/src/components/AppShell.tsx`, `app/src/shell.ts` (pure), `app/src/shell.css`
- Modify: `app/src/App.tsx` (render `AppShell`), `app/src/components/CommandCenter.tsx` (export the stage body only)
- Test: `test/shell.test.ts`

**Interfaces:**
- Consumes: `Icon` (Task 1), `StageScreen`.
- Produces: `export type RailItem = { id: StageScreen; labelKey: Key; icon: IconName }`; `export const RAIL: RailItem[]` (9 items, settings last); `export function railOrder(screen: StageScreen): number`; `export function shouldCollapse(width: number): boolean` (`width < 900`); `export function AppShell(props: { screen: StageScreen; onNavigate: (s: StageScreen) => void; context: ReactNode; composer: ReactNode; children: ReactNode; connected: boolean }): JSX.Element`.

- [ ] **Step 1: Write `test/shell.test.ts`** (source-level + pure)

Assert: `RAIL` has 9 entries, `settings` last, ids unique; `shouldCollapse(899) === true`, `shouldCollapse(900) === false`; `AppShell.tsx` renders `<nav`, `<main`, `<aside` exactly once each; `app/src/shell.css` contains `.rail`, `.topbar`, `.stage`, `.context`, and a `@media (max-width: 900px)` block; `App.tsx` mounts `composer` outside the `main` element.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `app/src/shell.ts` and `AppShell.tsx`** — three-column CSS grid (`64px 1fr 300px`), collapse below 900 px (rail becomes a bottom bar, context becomes a drawer), focus-visible rings from `--accent-soft`, 160 ms transitions inside `prefers-reduced-motion: no-preference`.

- [ ] **Step 4: Rewire `App.tsx`** — keep every screen's props; move the composer markup into a `<form className="composer">` passed to `AppShell`; keep `Ctrl+K` wiring for Task 4 as a no-op placeholder that opens nothing yet.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc -p app/tsconfig.json --noEmit && npx vite build --config app/vite.config.ts && npx vitest run test/shell.test.ts`
```bash
git add app/src/components/AppShell.tsx app/src/shell.ts app/src/shell.css app/src/App.tsx app/src/components/CommandCenter.tsx test/shell.test.ts
git commit -m "feat(ui): rail, stage, context panel and a persistent composer"
```

---

## Task 4: Command palette

**Files:**
- Create: `app/src/palette.ts`, `app/src/components/Palette.tsx`
- Modify: `app/src/App.tsx` (mount, `Ctrl+K` / `Escape`)
- Test: `test/palette.test.ts`

**Interfaces:**
- Produces: `export type PaletteItem = { id: string; label: string; hint?: string; kind: 'screen' | 'action' | 'model' | 'memory'; run: () => void }`; `export function rank(query: string, items: PaletteItem[], limit?: number): PaletteItem[]` — case- and diacritic-insensitive substring first, then subsequence, stable by label, `memory:` prefix filters to `kind === 'memory'`.

- [ ] **Step 1: Write `test/palette.test.ts`**

Cases: `rank('mem', …)` puts Memory first; `rank('')` returns the first `limit` items in input order; `rank('set')` matches "Settings" and "Reset profile"; `rank('memory:rent')` returns only memory items; Turkish `rank('hafıza', [ {label:'Hafıza'} ])` matches (fold before compare); ties keep input order; no match returns `[]`.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `palette.ts`** (reuse the fold used elsewhere: `.normalize('NFD')` + strip combining + `ı→i`). Then `Palette.tsx`: a fixed overlay, one input, `↑/↓/Enter`, grouped by `kind`, `aria-modal="true"`, focus trapped, `Escape` closes.

- [ ] **Step 4: Mount it** — `Ctrl+K` toggles from anywhere, items built from `RAIL`, three actions (`New chat`, `Consolidate now`, `Open data folder`), the model list from settings, and the last 20 memory titles.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc -p app/tsconfig.json --noEmit && npx vitest run test/palette.test.ts`
```bash
git add app/src/palette.ts app/src/components/Palette.tsx app/src/App.tsx test/palette.test.ts
git commit -m "feat(ui): command palette with fuzzy search and memory lookup"
```

---

## Task 5: Settings as a control room

**Files:**
- Create: `app/src/settings-model.ts`
- Modify: `app/src/components/Settings.tsx` (rewrite), `server/settings.ts` (new fields), `shared/i18n/{en,tr}.ts`
- Test: `test/settings-model.test.ts`, `test/settings.test.ts` (extend)

**Interfaces:**
- Produces: `export type SettingsSection = { id: 'model' | 'voice' | 'computer' | 'memory' | 'autonomy' | 'interface' | 'updates' | 'advanced'; titleKey: Key; fields: SettingsField[] }`; `export type SettingsField = { key: keyof Settings | `providers.${string}` | 'probe'; kind: 'text' | 'secret' | 'select' | 'toggle' | 'number' | 'readonly' | 'button'; labelKey: Key; hintKey?: Key; options?: { value: string; labelKey?: Key; label?: string }[] }`; `export const SECTIONS: SettingsSection[]`.
- Produces settings fields: `computerControl: 'off' | 'ask' | 'allow'`, `screenshots: boolean`, `fallbackModel: string`, `consolidationHour: number | null`, `density: 'comfortable' | 'compact'`, `reducedMotion: boolean`, `voiceSpeed: number` (0.7–1.3), `voiceByLang: Record<'tr-TR' | 'en-US', string>`.

- [ ] **Step 1: Write `test/settings-model.test.ts`**

Assert: 8 sections in the order above; `SECTIONS` contains **no** field whose key is `coldStorageThreshold`, `evidenceRule`, `updateChannel` or `accentIntensity` (the cut controls); every `field.key` is a real key of `DEFAULT_SETTINGS` or `'probe'`; every `labelKey` exists in both dictionaries.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Add the settings fields** to `Settings`/`DEFAULT_SETTINGS` with the defaults from the spec (`computerControl: 'ask'`, `screenshots: true`, `fallbackModel: ''`, `consolidationHour: null`, `density: 'comfortable'`, `reducedMotion: false`, `voiceSpeed: 1`, `voiceByLang: { 'tr-TR': 'tr_TR-dfki-medium', 'en-US': 'en_GB-alba-medium' }`) and validate them in `patch()` (reject unknown enum values, clamp `voiceSpeed`).

- [ ] **Step 4: Implement `settings-model.ts`**, then rewrite `Settings.tsx` as the two-pane layout (section list left, field cards right) driven by `SECTIONS`; keep the existing save path (`PATCH /api/settings`) and the existing secret handling.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc -p tsconfig.json --noEmit && npx tsc -p app/tsconfig.json --noEmit && npx vitest run test/settings-model.test.ts test/settings.test.ts`
```bash
git add app/src/settings-model.ts app/src/components/Settings.tsx server/settings.ts shared/i18n test/settings-model.test.ts test/settings.test.ts
git commit -m "feat(settings): eight sections, no control without behaviour"
```

---

## Task 6: Provider probe

**Files:**
- Create: `server/engine/providers/probe.ts`
- Modify: `server/http/server.ts` (route), `server/engine/providers/registry.ts` (EVREN preset)
- Test: `test/provider-probe.test.ts`

**Interfaces:**
- Produces: `export function normaliseAddress(raw: string): string` (trim, add scheme, strip trailing `/`; `http` for `localhost`, `127.0.0.1`, `[::1]`, `*.local`, else `https`); `export function inferKind(address: string): ProviderKind`; `export function providerIdFor(address: string): string` (known preset id, else `custom:<host>`); `export function parseModelList(kind: ProviderKind, body: unknown): { id: string; context?: number }[]`; `export async function probeProvider(opts: { address: string; key: string; fetchImpl?: typeof fetch }): Promise<ProbeResult>` where `ProbeResult = { ok: true; kind: ProviderKind; providerId: string; models: { id: string; context?: number }[] } | { ok: false; error: string }`.
- Produces route `POST /api/provider/probe` body `{ address, key }`, 200 with `ProbeResult`, 400 on empty address.
- Produces registry entry `{ id: 'evren', label: 'EVREN (SSB)', kind: 'openai', baseUrl: 'https://evren-llmapi.ssyz.org.tr/v1', requiresKey: true, local: false, hint: 'SSB · OpenAI-compatible' }`.

- [ ] **Step 1: Write `test/provider-probe.test.ts`**

Cases: `normaliseAddress('api.openai.com/v1')` → `https://api.openai.com/v1`; `normaliseAddress(' http://127.0.0.1:1234/v1/ ')` → `http://127.0.0.1:1234/v1`; `inferKind('https://api.anthropic.com/v1')` → `anthropic`; `providerIdFor` returns `evren` for the EVREN host and `custom:my.host` for a stranger; `parseModelList('openai', { data: [{ id: 'a', context_length: 8192 }] })` → `[{ id: 'a', context: 8192 }]`; `top_provider.context_length` is read; unknown shape → `[]`; **HTML body** (`'<html>'`) → `[]` and `probeProvider` returns `{ ok: false, error }` containing the status; a 401 surfaces the server's `error.message`; a timeout under 6 s returns `{ ok: false }` (inject a fetch that never resolves and assert via fake timers).

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `probe.ts`** — one request per kind (Bearer / `x-api-key` + `anthropic-version: 2023-06-01` / `?key=`), `AbortSignal.timeout(6000)`, `try/catch` around `res.json()`.

- [ ] **Step 4: Add the route and the EVREN preset**, plus the `server.http` test case for 400 and 200.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run test/provider-probe.test.ts test/http-settings.test.ts`
```bash
git add server/engine/providers/probe.ts server/engine/providers/registry.ts server/http/server.ts test/provider-probe.test.ts test/http-settings.test.ts
git commit -m "feat(providers): probe one address, list its models, ship an EVREN preset"
```

---

## Task 7: Model picker wired to the probe

**Files:**
- Modify: `app/src/components/Settings.tsx` (Model section), `server/settings.ts` (`providers.<id>` write path)
- Test: `test/settings.test.ts` (extend)

**Interfaces:**
- Consumes: `probeProvider`, `providerIdFor`.
- Produces: `applyProbe(store: SettingsStore, input: { address: string; key: string; models: string[]; providerId: string; model: string }): Settings` — writes `providers[providerId] = { baseUrl, model }`, stores the key under the base id (`evren`, `custom`), sets `provider`/`model`, returns the new settings.

- [ ] **Step 1: Write the test** — `applyProbe` with `custom:my.host` stores the config under `custom:my.host` but the secret under `custom`; a second address (`custom:other.host`) keeps the first one's config and secret intact.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `applyProbe`**, then the Model section: address + key + **Detect** (spinner, error text verbatim), model `<select>` with `context` in the label, manual fallback fields always editable.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run test/settings.test.ts && npx tsc -p app/tsconfig.json --noEmit`
```bash
git add app/src/components/Settings.tsx server/settings.ts test/settings.test.ts
git commit -m "feat(settings): paste an address, detect the provider, pick a model"
```

---

## Task 8: Vision content blocks (structural)

**Files:**
- Modify: `server/engine/types.ts`, `server/engine/providers/{openai,anthropic,google}.ts`, `server/engine/history.ts`, `server/engine/loop.ts`, `server/sessions.ts`, `server/memory/notes.ts` (recall formatting), `shared/i18n/{en,tr}.ts`
- Test: `test/vision-blocks.test.ts`, `test/engine/history.test.ts` (extend), one fixture test per adapter

**Interfaces:**
- Produces: `export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; mediaType: 'image/png' | 'image/jpeg'; base64: string }`; `ChatMessage['content']` becomes `string | ContentBlock[]`; `export function textOf(content: ChatMessage['content']): string` (joins text blocks, ignores images); `export function withImage(text: string, image: { mediaType: string; base64: string }): ContentBlock[]`.

- [ ] **Step 1: Write `test/vision-blocks.test.ts`**

Assert: `textOf('hi') === 'hi'`; `textOf([{type:'text',text:'a'},{type:'image',…},{type:'text',text:'b'}]) === 'a\nb'`; `withImage('look', img)` order is text-then-image; the OpenAI adapter fixture emits `image_url` with a `data:` URL; the Anthropic fixture emits `{ type: 'image', source: { type: 'base64', media_type, data } }` before the text; the Google fixture emits `inline_data`; a message with only an image produces no empty text part; `trimHistory` keeps an image block's message when it is the newest user turn.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Widen the type and fix every compile error** — `textOf` wherever code assumed a string (loop, notifications, memory recall, distiller input, session titles). Adapters serialise blocks; the fake provider stores content as-is.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`
```bash
git add server test
git commit -m "feat(engine): content blocks so a screenshot can reach a vision model"
```

---

## Task 9: Piper voice engine

**Files:**
- Create: `server/voice/piper.ts`, `server/voice/assets.ts`, `server/voice/playback.ts`
- Modify: `server/voice/index.ts` (dispatch `speak` to Piper first), `server/engine/tools/speak.ts`, `server/http/server.ts` (`POST /api/voice/speak`)
- Test: `test/voice-piper.test.ts`, `test/voice-assets.test.ts`

**Interfaces:**
- Produces: `export const VOICE_ASSETS: { id: string; lang: 'tr-TR' | 'en-US'; file: string; url: string; sha256: string; bytes: number; license: string }[]` (two voices + the binary archive).
- Produces: `export async function synthesise(opts: { text: string; lang: 'tr-TR' | 'en-US'; dataDir: string; speed?: number; voice?: string; timeoutMs?: number }): Promise<{ wav: Buffer; cached: boolean }>`; throws `VoiceEngineMissing` when the binary is absent.
- Produces: `export async function playWav(wav: Buffer, opts?: { timeoutMs?: number }): Promise<boolean>` (PowerShell `System.Media.SoundPlayer`, returns false instead of throwing).
- Produces route `POST /api/voice/speak` → `audio/wav`, 503 `{ error: 'voice engine missing' }` when absent.

- [ ] **Step 1: Write `test/voice-piper.test.ts`**

Cases: synthesis writes the text to stdin and reads a WAV from stdout (fake binary = a Node script that echoes a tiny WAV); the same text twice is served from cache (`cached: true` on the second call); cache holds at most 50 entries (51st evicts the oldest); `speed` is passed as `--length_scale` inverse; a non-zero exit throws and leaves no partial file; `timeoutMs` aborts and kills the child; `playWav` returns `false` when PowerShell is unavailable (inject `runImpl`).

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement** `assets.ts` (pinned hashes, real values fetched once at build time and committed), `piper.ts` (spawn, `AbortSignal`, 15 s default, in-memory LRU of 50 Buffers), `playback.ts` (encoded command, `SoundPlayer`), and the route.

- [ ] **Step 4: Route the `speak` tool and `speakReplies` through Piper**, keeping Web Speech as the renderer-only fallback and logging `voice.engine` once per session.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run test/voice-piper.test.ts test/voice.test.ts`
```bash
git add server/voice server/engine/tools/speak.ts server/http/server.ts server/settings.ts test/voice-piper.test.ts test/voice-assets.test.ts
git commit -m "feat(voice): offline Piper synthesis, cached and played server-side"
```

---

## Task 10: Voice install on first run

**Files:**
- Create: `server/voice/install.ts`
- Modify: `server/serve.ts` (install state on the dashboard payload), `app/src/components/Settings.tsx` (Voice section state), `app/src/App.tsx` (first-run gate), `shared/i18n/{en,tr}.ts`
- Test: `test/voice-install.test.ts`

**Interfaces:**
- Produces: `export type InstallState = { phase: 'missing' | 'downloading' | 'verifying' | 'ready' | 'failed'; file?: string; received?: number; total?: number; error?: string }`; `export async function installVoiceAssets(opts: { dataDir: string; onProgress?: (s: InstallState) => void; fetchImpl?: typeof fetch; assets?: typeof VOICE_ASSETS }): Promise<InstallState>`; `export function voiceReady(dataDir: string): boolean`.
- Produces: dashboard field `voiceInstall: InstallState`; `POST /api/voice/install` starts it (idempotent), progress over the existing event hub.

- [ ] **Step 1: Write `test/voice-install.test.ts`**

Cases: a fresh dir downloads all assets and reports `ready`; a `Range` resume continues from a partial file (assert the request's `Range` header); a checksum mismatch deletes the file and retries exactly once, then reports `failed` with the file name; an already-complete dir reports `ready` without a request; a failing fetch sets `failed` and leaves the completed files in place; progress monotonic.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `install.ts`** (mkdir, `.part` files, `sha256` via `node:crypto`, rename on success), route, and the "Preparing KAREN" screen: a centred reactor mark with a determinate bar, one line per asset, a "Skip for now" that sets `phase: 'failed'` with `error: 'skipped'`.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run test/voice-install.test.ts && npx tsc -p tsconfig.json --noEmit`
```bash
git add server/voice/install.ts server/serve.ts app/src test/voice-install.test.ts shared/i18n
git commit -m "feat(voice): download and verify the voice engine on first run"
```

---

## Task 11: Computer-control tools

**Files:**
- Create: `server/engine/tools/computer-control.ts`, `server/engine/computer-policy.ts`
- Modify: `server/engine/tools/index.ts`, `server/engine/permissions.ts` (autonomous denial stays), `server/http/server.ts` (`POST /api/computer/stop`), `electron/main.cjs` (`globalShortcut`), `shared/i18n/{en,tr}.ts`
- Test: `test/computer-policy.test.ts`, `test/computer-control.test.ts`

**Interfaces:**
- Produces tools: `mouse_move`, `mouse_click`, `mouse_drag`, `scroll`, `type_text`, `press_keys`, `window_list`, `window_focus`, `window_move`, `window_close`, `ui_tree`, `ui_invoke` (all `access: 'exec'` except `window_list`/`ui_tree`, which are `'read'`). `screen_read` belongs to Task 12.
- Produces: `export function decideComputerAction(input: { tool: string; args: Record<string, unknown>; mode: 'off' | 'ask' | 'allow'; secrets: string[] }): 'deny' | 'ask' | 'approve'`; `export const SECRET_SHAPE = /(password|passwd|parola|şifre|sifre|token|api[_-]?key|secret)\s*[:=]/i`; `export const MAX_ACTIONS_PER_TURN = 30`.
- Produces: `export function buildInputScript(op: InputOp): string` — the PowerShell + `Add-Type` body, pure and snapshot-tested.

- [ ] **Step 1: Write `test/computer-policy.test.ts`**

Cases: `mode: 'off'` → `deny` for every tool; `mode: 'ask'` → `ask` for mutating, `approve` for `window_list`/`ui_tree`; `mode: 'allow'` → `approve` for `mouse_click` but `ask` for `window_close`, and `ask` for `type_text` whose text matches `SECRET_SHAPE` or contains any string from `secrets`; an unknown tool → `ask` (never silently approve).

- [ ] **Step 2: Write `test/computer-control.test.ts`**

Cases: `buildInputScript({ kind: 'type_text', text: 'ğüşıöç' })` uses `SendInput` with `KEYEVENTF_UNICODE`, not `SendKeys`; `mouse_click` sends absolute coordinates scaled by the primary screen size; `press_keys` maps `ctrl+shift+t` to virtual-key codes and rejects unknown keys; the tool refuses when `computerControl === 'off'` (not in schema); the 31st action in one turn returns `{ ok: false, output: 'action limit reached' }`; a missing Windows host returns `{ ok: false, output: 'windows only' }`; `mouse_drag` always emits a release even when the move throws.

- [ ] **Step 3: Run — expect failure.**

- [ ] **Step 4: Implement** the policy, the script builder and the tools; add `POST /api/computer/stop` (aborts the active session), and `globalShortcut.register('Control+Alt+K', …)` in `main.cjs` guarded by `app.isPackaged || process.env.NODE_ENV === 'development'`.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run test/computer-policy.test.ts test/computer-control.test.ts && npx tsc -p tsconfig.json --noEmit`
```bash
git add server/engine/tools/computer-control.ts server/engine/computer-policy.ts server/engine/tools/index.ts server/http/server.ts electron/main.cjs test/computer-policy.test.ts test/computer-control.test.ts shared/i18n
git commit -m "feat(computer): direct input, window and UIA control behind one policy"
```

---

## Task 12: Screen reading with vision

**Files:**
- Create: `server/engine/tools/screen.ts`
- Modify: `server/engine/tools/index.ts`, `app/src/App.tsx` (CONTROL badge), `shared/i18n/{en,tr}.ts`
- Test: `test/computer-screen.test.ts`

**Interfaces:**
- Consumes: `ContentBlock` (Task 8), `decideComputerAction` (Task 11).
- Produces: tool `screen_read` input `{ monitor?: number; region?: { x: number; y: number; width: number; height: number }; maxWidth?: number }`, output blocks `[{ type: 'text', text }]` or `[{ type: 'text' }, { type: 'image', mediaType: 'image/png', base64 }]`; `export function scaleForVision(width: number, height: number, maxWidth?: number): number`.

- [ ] **Step 1: Write `test/computer-screen.test.ts`**

Cases: `scaleForVision(3840, 2160, 1568)` → `1568/3840`; already-small images return `1`; a capture failure returns a text-only result naming the error, never a throw; the image block's `mediaType` is `image/png`; when the active model reports no vision (settings `modelVision: false`), the result is text-only and mentions the file path.

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement** — `System.Drawing` capture into a temp PNG under `karen-data/screens/`, downscale before encoding, base64, delete files older than one hour on capture.

- [ ] **Step 4: Add the CONTROL badge** — `App.tsx` shows a red pill while a `computer_*` tool is mid-flight; clears on `tool_result`.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run test/computer-screen.test.ts && npx vitest run`
```bash
git add server/engine/tools/screen.ts app/src/App.tsx test/computer-screen.test.ts shared/i18n
git commit -m "feat(computer): screenshot reading that reaches a vision model"
```

---

## Task 13: First-run wizard

**Files:**
- Create: `app/src/components/Onboarding.tsx`, `app/src/onboarding.ts` (pure), `server/first-run.ts`
- Modify: `app/src/App.tsx`, `server/settings.ts` (`onboarded: boolean`), `shared/i18n/{en,tr}.ts`
- Test: `test/onboarding.test.ts`

**Interfaces:**
- Produces: `export type OnboardingStep = 'welcome' | 'language' | 'provider' | 'model' | 'voice' | 'ready'`; `export function nextStep(current: OnboardingStep, state: { configured: boolean; voiceReady: boolean }): OnboardingStep`; `export function shouldOnboard(settings: { onboarded: boolean }): boolean`.
- Produces: `POST /api/onboarding/complete` sets `onboarded: true`.

- [ ] **Step 1: Write the test** — `shouldOnboard` false when `onboarded`; `nextStep('welcome', …)` → `language`; provider step is skipped when `configured`; voice step is skipped when `voiceReady`; `ready` is terminal; an existing 1.0.0 profile (`provider` not `ollama`, `onboarded` false) still onboards but skips `provider`/`model`.

- [ ] **Step 2: Run — expect failure; implement; verify.**

Run: `npx vitest run test/onboarding.test.ts && npx tsc -p app/tsconfig.json --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/src/components/Onboarding.tsx app/src/onboarding.ts server/first-run.ts app/src/App.tsx server/settings.ts test/onboarding.test.ts shared/i18n
git commit -m "feat(onboarding): six screens from install to first answer"
```

---

## Task 14: Demo profile and real screenshots

**Files:**
- Create: `scripts/demo-profile.mjs`, `scripts/capture-screens.ps1`, `docs/assets/showcase/*`
- Test: `test/showcase.test.ts`

**Interfaces:**
- Produces: `node scripts/demo-profile.mjs <dir>` seeding four projects, twelve notes (one trauma), one resolved conflict, three inbox lines, one pending approval, and a fake provider; `scripts/capture-screens.ps1` capturing five windows (Command Center, Chat with an approval card, Memory, Brain Map, Settings) at 1.5× DPI into `docs/assets/showcase/`.

- [ ] **Step 1: Write `test/showcase.test.ts`**

Assert: the five PNGs exist and are > 40 KB; each is a valid PNG with width ≥ 1200; no file name contains `zero`; `docs/assets/showcase/` has no `*.tmp`.

- [ ] **Step 2: Implement the seeder**, run it against a temp dir, start `serve --data <temp> --root app/dist`, capture the five windows, name them `command-center.png`, `chat-approval.png`, `memory.png`, `brain-map.png`, `settings.png`.

- [ ] **Step 3: Verify by eye** — open each capture; reject any that shows a real path, memory text, or key.

---

## Task 15: README, site and release

**Files:**
- Modify: `README.md`, `site/index.html`, `CHANGELOG.md`, `package.json` (1.1.0)
- Test: `test/readme.test.ts`, `test/site.test.ts` (extend), `test/urls.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write `test/readme.test.ts`** — README has the section order from the spec (icon → claim → links → what → showcase → download → screens → memory/autonomy/safety → architecture → development → docs → license); every `docs/assets/showcase/*.png` it references exists; no `C:\` path; no `zero`; English only.

- [ ] **Step 2: Rewrite `README.md`** and the site hero to use the captures and the mark; keep the terminal-flavoured blocks.

- [ ] **Step 3: Bump to 1.1.0**, write the CHANGELOG entry, run the full gate, tag and release.

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit && npx tsc -p app/tsconfig.json --noEmit && npm run build`
```bash
git add -A && git commit -m "release: karen 1.1.0"
git tag v1.1.0 && git push origin master --tags
```

---

## Self-review notes

- **Spec coverage:** §1 shell → T3; §2 visual language → T1; §3 icons → T1/T2; §4 settings → T5/T7; §5 probe + EVREN → T6/T7; §6 voice → T9/T10; §7 computer control → T11/T12; §8 first run → T13; §9 README/site → T14/T15; D1 → T8/T12; D7 cut controls → T5 test.
- **Ordering:** T8 (vision) precedes T12 (screen); T11 precedes T12; T1 precedes T3; T6 precedes T7.
- **Deferred, not forgotten:** Kokoro-English voice (spec Backlog), native input helper (spec §7 option b), code signing.
