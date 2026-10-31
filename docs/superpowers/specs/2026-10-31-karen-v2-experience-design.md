# KAREN 1.1 — Experience Redesign

**Status:** design, awaiting approval
**Date:** 2026-10-31
**Supersedes:** nothing; builds on 1.0.0

## Why

1.0.0 works. It does not *feel* like the thing it claims to be: the interface is a wall
of glowing boxes, the icon is a red "K", Settings is nine fields, the model field is free
text that most people cannot fill in, the voice is the OS robot, and the computer tools
only open apps and take screenshots. The owner's words: "arayüz fenasal kötü", "çok
nenumsu", "JARVIS gibi yetkileri olsun, direkt PC'ye erişim".

This release makes KAREN look and behave like an assistant you would actually leave
running, and makes the first five minutes survivable: paste one API address, get a model
list, pick one, talk to it.

## What success looks like

- A stranger installs, and within two minutes has a model answering, in a window that
  looks deliberate.
- The owner stops apologising for the UI.
- Turkish speech sounds like a person, works with the network off, and required zero
  manual downloads.
- "Ekrandaki şu düğmeye bas" works without KAREN asking the user to run a command.

## Goals

1. A new shell: icon rail, single stage, contextual right panel, command palette.
2. A visual language that is quiet: red on near-black, one narrow secondary hue, no glow
   except the core, no emoji anywhere.
3. Settings that are a control room, not a form.
4. One API address + key, provider auto-detected, models listed from the endpoint.
5. EVREN as a first-class provider preset.
6. Small, consistent icons in the app and a JARVIS-style app icon.
7. Offline neural speech, female, installed automatically on first run.
8. Direct computer control: mouse, keyboard, windows, clipboard — as tools, not shell.
9. A README and landing page modelled on nashi-app (real screenshots, honest copy) with
   twigpine/zero's terminal flavour.

## Non-goals

- No new npm runtime dependency for UI, icons, or speech.
- No code signing this release (still unsigned, still documented).
- No mobile, no web-hosted KAREN, no multi-user.
- No plugin marketplace; skills stay as they are.
- Kokoro/XTTS voice engines (see Voice: why not).

## Anti-goals

- A prettier skin with the same nine settings.
- A second permission system that quietly bypasses the first.
- Screenshots of a mock-up presented as the product (README must show the real build).
- Speech that needs the network to answer.

## Constraints

- `127.0.0.1`-only server, token + Origin check stay.
- Nothing may reach the computer without a permission decision and an audit line.
- Turkish data (stop words, fold tables, world-model patterns) is not translated.
- The bilingual dictionary stays the single source of UI text; no hardcoded strings.
- Windows is the shipped target; the server keeps working as plain Node.
- Tests: every behaviour added gets a test; suite must stay green and typed.
- No file may be written with PowerShell `Get-Content`/`Set-Content` (corrupts UTF-8).

## Approaches considered

### Interface

- **(a) Deep restyle.** Keep the component tree, replace tokens, add icons. Cheap, low
  risk, but the information architecture — the actual reason it feels wrong — survives.
- **(b) New shell, same engines.** Replace the chrome: an icon rail, one stage, a
  contextual right panel, a global composer, a command palette. Screens keep their data
  and their components, restyled against a new token set.
- **(c) Rewrite every screen from scratch.** Highest cost, and the screens are not the
  problem; the frame is.

**Chosen: (b).** The stage/panel split is what makes JARVIS feel calm: one thing at a
time, with context available, never four dashboards shouting.

### Voice

- **Piper** — standalone `piper.exe` + one ONNX voice per language, ~40–80 MB each,
  real-time on CPU, MIT, fully offline. Quality: clearly better than SAPI, short of
  cloud. Turkish voices exist (`tr_TR-dfki-medium`, female).
- **Kokoro-82M** — the recommendation during discovery. More natural in English, ~330 MB,
  runs through ONNX Runtime. Two problems: **Kokoro has no Turkish voice**, and the
  runtime is a heavy native/wasm dependency on a codebase that just spent a day fighting
  native ABI in packaging.
- **XTTS-v2** — best quality, 2 GB+, slow on CPU. Out.

**Chosen: Piper for both languages, two female voices shipped** (`tr_TR-dfki-medium`,
`en_GB-alba-medium`), more voices selectable in Settings. This is a deliberate change
from the discovery recommendation: one engine, both languages, no new dependency, no ABI
surface. **Backlog:** if English quality is judged insufficient, add Kokoro for English
only, behind the same "voice" abstraction — the interface for that is built now (an
`engine` field and a `VoiceEngine` interface with one implementation).

### Computer control

- **(a) PowerShell + inline P/Invoke C#**, as `computer.ts` already does for window
  focus. Zero new dependencies, ships today, ~200 lines of P/Invoke.
- **(b) A native helper binary** (C#/Rust) with an RPC surface. Sturdier, but adds a build
  chain, a second binary to sign, and a process to supervise.
- **(c) Keep the current five tools.** Not "JARVIS".

**Chosen: (a).** One `powershell.exe` invocation per action, behind a policy gate, with a
hard stop. If latency or reliability becomes a real complaint, (b) is a drop-in behind
the same tool names.

## Design

### 1. Shell

```
┌────┬──────────────────────────────────────────┬──────────────┐
│    │  KAREN · Command Center        ⌘K   ● 12:04 │  CONTEXT     │
│ ▦  ├──────────────────────────────────────────┤              │
│ ◍  │                                          │  live feed   │
│ ✉  │              STAGE                       │  agents      │
│ ◈  │        (one screen, full height)         │  approvals   │
│ ❖  │                                          │              │
│ ✦  │                                          │              │
│ ↗  │                                          │              │
│    ├──────────────────────────────────────────┤              │
│ ⚙  │  ┌ composer ──────────────────── 🎙  ➤ ┐ │              │
└────┴──────────────────────────────────────────┴──────────────┘
```

- **Rail** (64 px): icons only, tooltip on hover, 2 px red marker for the active screen,
  mic state at the bottom, Settings pinned.
- **Top bar**: screen title, live chips (model, state phase, uptime), palette hint,
  right side: connection dot.
- **Stage**: the current screen, unchanged in data, restyled.
- **Context panel** (300 px, collapsible, per-screen default): Command Center → live feed;
  Chat → agents + approvals; Memory → conflicts; Map → selected node.
- **Composer**: always mounted. Collapsed to one line, expands on focus, holds mic,
  wake indicator, send, and a "stop" that cancels the running turn.
- **Command palette** (`Ctrl+K`): fuzzy over screens, actions (new chat, sleep now, open
  data folder), models, providers, memory search. Keyboard-first; mouse optional.
- **Mobile/narrow (<900 px)**: rail collapses to a bottom bar, context panel becomes a
  drawer. One breakpoint, not a second layout.

### 2. Visual language

Tokens (one file, `app/src/styles.css`, everything else references them):

| Token | Value | Use |
|---|---|---|
| `--bg` | `#08080a` | window |
| `--surface` | `#0e0e12` | rail, top bar |
| `--panel` | `#14141a` | cards |
| `--raised` | `#1b1b22` | hover, inputs |
| `--line` | `#241016` | 1 px separators |
| `--text` | `#ececef` | |
| `--muted` | `#8f8f99` | |
| `--faint` | `#5a5a63` | timestamps |
| `--accent` | `#e11d2e` | active, primary action |
| `--accent-soft` | `#ff5a66` | hover, focus ring |
| `--ok` | `#5dd1a4` | |
| `--warn` | `#ffc25c` | |
| `--data` | `#6ea8fe` | **only** in graph edges, sparklines, chart series, ≤20 % opacity |

Rules:

- No gradients except the core orb. No box-shadow except focus rings and the orb.
- Radius: 10 px cards, 8 px controls, 999 px pills. 8 px spacing grid.
- Type: Inter for UI, JetBrains Mono for ids, counts, paths, timestamps.
- Uppercase only for 11 px section labels with 0.08em tracking (`--faint`).
- Motion: 160 ms ease-out, 240 ms for the orb; all of it inside
  `@media (prefers-reduced-motion: no-preference)`.
- Never emoji. Every glyph is an SVG from the icon set.

### 3. Icons

`app/src/icons.tsx` — a hand-written set (stroke 1.5, 20×20 viewBox, `currentColor`),
about 34 glyphs: 9 nav, 8 actions (send, mic, stop, attach, copy, refresh, approve,
reject), 6 status (online, offline, thinking, done, warning, error), 8 provider marks
(Ollama, LM Studio, OpenAI, Anthropic, Google, EVREN, Groq, generic OpenAI-compatible),
3 misc (settings, palette, chevron). Providers are monochrome marks, not brand logos.

App icon: `electron/icon.png` 512×512, redrawn as an arc reactor — black rounded tile,
three concentric thin rings, a segmented coil ring, a small bright core, no text. Same
artwork becomes `site/assets/karen-mark.svg` for the site and README.

### 4. Settings

Left column of sections, right side the active section. Sections and fields:

| Section | Fields |
|---|---|
| **Model** | API address, API key (masked), **Detect** button, provider (auto-filled, editable), model (searchable list from the endpoint, with context size), fallback local model |
| **Voice** | engine (Piper), voice per language, speed, pitch, output device, wake phrase on/off, test button, "download voice" state |
| **Computer** | mode (off / ask / allow), screenshots allowed, clipboard allowed, alt-tab allowed, **Stop KAREN now** |
| **Memory** | notes per turn, sleep schedule, cold-storage threshold, evidence rule (read-only notice) |
| **Autonomy** | enabled, idle minutes, daily runs, research, quiet hours |
| **Interface** | language, accent intensity (standard / calm), density (comfortable / compact), reduced motion, start screen |
| **Updates** | check now, channel (stable), last check, current version |
| **Advanced** | data folder + open, open event log, export settings, import settings, reset profile |

Each section is a card list, not a form grid: label, one-line explanation, control. Every
control writes through the existing `PATCH /api/settings` and re-renders without reload.

### 5. Provider detection and models

New server endpoint `POST /api/provider/probe` with `{ address, key }`:

1. Normalise the address (add `https://` if missing, strip trailing `/`).
2. Infer kind from the host: `anthropic` → Anthropic; `generativelanguage.googleapis` →
   Google; otherwise OpenAI-compatible.
3. Probe `GET {address}/models` with `Authorization: Bearer <key>` (Anthropic:
   `x-api-key` + `anthropic-version`; Google: `?key=`), 6 s timeout.
4. Return `{ kind, models: [{ id, context? }], providerId }` — `providerId` is a known
   preset when the address matches one, else `custom`.

Settings applies the result: writes `providers.<id> = { baseUrl, model }`, stores the key
in `secrets.json`, sets `provider`/`model`. If the probe fails, the raw error is shown
verbatim (status + message) and the fields stay editable — never a dead end.

EVREN is added as a preset: `id: 'evren'`, label `EVREN (SSB)`, base
`https://evren-llmapi.ssyz.org.tr/v1`, OpenAI-compatible, key required. Its model list
comes from the same probe.

### 6. Voice pipeline

- **Engine**: `piper.exe` in `karen-data/voice/bin/`, voices in `karen-data/voice/voices/`.
- **Server**: `POST /api/voice/speak { text, lang }` → WAV (`audio/wav`), synthesised by
  spawning piper with the selected voice; cached by text hash (last 50).
- **Renderer**: plays the returned WAV through one `<audio>` element; falls back to Web
  Speech only if the engine is missing (and says so once).
- **Tool**: the existing `speak` tool uses the same path, so speech works with the window
  closed.
- **Install**: first run shows a "Preparing KAREN" screen that downloads the binary and
  the two voices (~180 MB total) with progress, resumable, skippable ("later" leaves a
  Settings banner). Nothing else about first run is manual.
- **Settings → Voice** can re-download, switch voice, and test.

### 7. Computer control

New tool group `computer` (all `access: 'exec'`, all logged):

| Tool | Does | Default policy |
|---|---|---|
| `mouse_move` | move to x,y (optional easing) | ask |
| `mouse_click` | click at x,y or current, left/right/middle, double | ask |
| `mouse_drag` | press, move, release | ask |
| `scroll` | wheel by amount at a point | ask |
| `type_text` | type a string into the focused window | ask |
| `press_keys` | key combos (`ctrl+shift+t`) | ask |
| `window_list` | title, process, rect, focused flag | allow |
| `window_focus` / `window_move` / `window_close` | window ops | focus/move allow, close ask |
| `ui_tree` | UIAutomation outline of the focused window (name, type, automation id, rect) | allow |
| `ui_invoke` | invoke/select a UIA element by automation id or name | ask |
| `screen_read` | screenshot + scale, returned as an image to the model | allow if `screenshots` on |

Mechanics: one `powershell.exe -NoProfile -EncodedCommand` per action with inline C#
(`Add-Type`) for `user32`/`UIAutomationClient`; a compiled helper cache would be premature.

Policy: setting `computerControl: 'off' | 'ask' | 'allow'` (default `ask`). `off` removes
the tools from the schema entirely. `ask` routes every mutating action through the
existing approval broker. `allow` auto-approves input actions **except** anything typed
that matches a secret pattern, and except `window_close`.

Guard rails:

- A global stop: `Ctrl+Alt+K` and a tray item, kills the running turn and any pending
  input sequence.
- Every action emits an event (`tool`, coordinates, target window title) to the live feed.
- The UI shows a red `CONTROL` badge in the top bar while the agent has the keyboard or
  mouse.
- Rate limit: max 30 input actions per turn, then the turn is cut (same shape as the
  reflex monitor).

### 8. First-run

Six screens, skippable where sensible: welcome → language → API address + key + detect →
model pick → voice download → ready. Writes settings, then drops into the Command Center
with one suggested prompt. Existing profiles skip 1–5.

### 9. README and landing page

README, modelled on nashi-app and twigpine/zero:

1. Centred icon, `KAREN`, one-line claim + Turkish line, link row (site, release,
   issues, license).
2. Two paragraphs: what it is, what makes it different, and one honest
   "not affiliated / built with" note.
3. **See KAREN in action** — one real screen recording (GIF, ≤8 MB) plus a 2×2 screenshot
   grid with captions; every image captured from the built 1.1.0 app.
4. Download and use — installer, what first run does, unsigned warning, migration note.
5. Screens table, keyboard and voice shortcuts.
6. Memory / autonomy / safety model as short prose, terminal-styled blocks preserved.
7. Architecture tree, development, docs, contributing, license.

Landing page mirrors it: hero with the mark and one recording, a short feature grid, an
honest safety section, install steps. Same palette and type scale as the app.

Screenshots are captured from the running app with a PowerShell window capture (real
pixels, 1× and 1.5× DPI), saved to `docs/assets/showcase/`, and referenced by relative
path in the README so GitHub renders them.

## What the builder decides

- Exact SVG geometry for the glyphs and the reactor rings.
- Card vs. list rendering inside each Settings section.
- Piper voice shortlist beyond the two shipped.
- Cache eviction shape for synthesised WAVs.
- Whether `screen_read` downscales before or after encoding.
- Whether the palette searches memory live or only on explicit "memory:" prefix.

## Decisions taken at build review

These came out of a builder's read of this document and are now binding.

**D1 — Screen reading needs vision, and gets it.** Text-only content blocks cannot show a
screenshot, so `screen_read` requires image support end to end: `ChatMessage.content`
becomes `string | ContentBlock[]`, the three adapters (OpenAI-compatible, Anthropic,
Google) emit and parse image blocks, history trimming counts an image as one message, and
the fake provider accepts them. `screen_read` returns `{ path, width, height }` plus an
image block. Models that report no vision get the path and a one-line explanation instead
of a silent failure. This is the largest structural change in the release and is planned
on its own.

**D2 — Permission interaction, exactly.** `computerControl` decides *availability and
default answer*, never bypasses the gate:

| Setting | Tool in schema | `classify()` | Approval |
|---|---|---|---|
| `off` | no | — | — |
| `ask` (default) | yes | `important` | card, as today |
| `allow` | yes | `important` | auto-approved by a policy wrapper |

Two cases ask even under `allow`: typed text that matches a secret pattern
(`/(password|passwd|parola|şifre|token|api[_-]?key|secret)\s*[:=]/i`) or that contains a
stored secret value; and `window_close`. Autonomous sessions never get computer tools —
`autonomousVerdict()` keeps denying everything except read-only network. The reflex
monitor and the 30-actions-per-turn limit apply in all modes.

**D3 — Voice assets.** Binary: `piper_windows_amd64.zip` from the project's GitHub
release; voices: `<lang>/<voice>/medium/<voice>.onnx` + `.onnx.json` from the public
piper-voices repository on Hugging Face (HTTP Range is supported, so downloads resume).
Each file's SHA-256 is pinned in `server/voice/assets.ts`; a mismatch deletes the file and
retries once. Nothing is redistributed with KAREN (the voices ship espeak-ng data under
GPL-3; downloading at runtime keeps it the user's copy). Both URLs are Settings-editable
for networks that block them, and an existing `%APPDATA%\KAREN\karen-data\voice\` folder is
used as-is.

**D4 — Audio with the window closed.** Playback is server-side, one short-lived
`powershell -NoProfile` per reply using `System.Media.SoundPlayer` on the default output
device. The renderer plays the same WAV while it is open (and can duck its own playback).
The "output device" field is **cut** — Windows' default device only; a device picker would
need a mixer library and is not worth a dependency.

**D5 — Stop is between actions, not mid-gesture.** Every input action is one atomic
script bounded to 2 s, so a stop cancels the turn and kills the running child; `mouse_drag`
releases the button in a `finally` block, so a kill cannot leave the mouse held. There is
no "pending input sequence" queue. `Ctrl+Alt+K` is registered in the Electron **main**
process (`globalShortcut`) so it works with the window hidden, and calls
`POST /api/computer/stop`.

**D6 — Probe details.** Context size is read from whichever of `context_length`,
`context_window`, `max_context_length` or `top_provider.context_length` the endpoint
returns, else shown as "—". A detected endpoint that is not a known preset is stored as
`custom:<host>` (label = host), so two different addresses never collide; registry and
secret lookups use the part before `:`. Addresses on `localhost`, `127.0.0.1`, `[::1]` and
`*.local` default to `http`, everything else to `https`.

**D7 — Settings ship only controls that do something.** Cut: cold-storage threshold
(no such knob), "evidence rule" (stays a read-only notice, not a switch), update channel
(always stable), accent intensity. Kept and real: notes per turn (wired to the existing
distill limit), fallback model (used when the primary provider errors), daily consolidation
hour (a timer in `serve.ts`, off by default), density and reduced motion (CSS data
attributes on `<html>`). A control without behaviour is worse than no control.

**D8 — Screenshots use a demo profile.** `scripts/demo-profile.mjs` seeds a throwaway data
directory (projects, notes, one resolved conflict, one inbox line, one approval) and the
captures point at it. The owner's real memory, paths and keys never appear in a published
image.

## Risks

| Risk | Mitigation |
|---|---|
| Piper Turkish sounds worse than expected | voice is swappable; Kokoro-English path designed for |
| P/Invoke input is flaky at non-100 % DPI | coordinates in physical pixels, `SetProcessDpiAwareness` in the helper |
| Auto-approve mode becomes a foot-gun | off by default, explicit copy, global stop, per-action audit |
| New shell breaks existing screens | screens keep their components; shell is additive, one shell test per screen |
| Icon/logo mismatch between app, site, README | one SVG source, rasterised by script |
| Release gets bigger | voice downloads at first run, not in the installer |

## Delivery

Two releases' worth of work if done at once; shipped as **1.1.0** in this order:

1. Icon + token set + icon set (visible win, no behaviour change).
2. New shell + palette.
3. Settings restructure.
4. Provider probe + EVREN + model picker.
5. Voice engine + first-run downloader.
6. Computer control tools + policy + stop.
7. Screenshots, README, site, release.
