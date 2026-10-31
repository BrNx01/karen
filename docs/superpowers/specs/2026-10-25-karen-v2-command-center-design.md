# KAREN v2 — Command Center, World Model, Regional Map, Voice

Date: 2026-10-25
Status: Approved (approach chosen by the user)

## 1. Intent

KAREN is a chat application today. The user wants to turn it into a **command
center**: a JARVIS-like dashboard, live status panels, the core in the middle.
Plus three things:

1. **World model:** memory does not only hold sentences; typed facts (number,
   date, duration, money), actions taken and their outcomes are stored.
   Calculations are made over them ("how much in total", "when was the last
   time", "when is the next one").
2. **Regional map:** the map initially shows only region boxes. Clicking a
   region opens **only that region**; not everything opens at once.
3. **Voice:** speak into the microphone, get a spoken answer; audio does not
   leave the device (local recognition).

Computer access already exists (files, shell, network, login). Missing pieces
are added: opening apps, screenshots, clipboard read/write, media control.

## 2. Goals

- Dashboard is the default screen; chat in the center of the dashboard, full
  screen with one click.
- Panels are fed with real data: sessions/agents, recent actions, memory
  summary, voice status, pending approvals, connected providers.
- The world model is exposed to the model as tools (`world_*`); deterministic
  queries work even without a model.
- Map regions: project, layer (memory/knowledge), concept cluster. Open/close a
  region.
- Voice: local recognition (whisper.cpp) + local speech synthesis
  (SAPI/speechSynthesis). If the model/binary is missing, the app keeps running
  and the voice feature shows as "not installed".

## 3. Non-goals

- "Simulated execution" without actually doing the actions (the user did not
  want it; it requires writing a preview model for every tool).
- Cloud speech recognition as the default (privacy).
- 3D/material-effect dashboard animations; CSS is enough.
- Multi-user, remote access.

## 4. Anti-goals

- Fails if voice data leaks out.
- Fails if the world model produces a made-up number (evidence is mandatory).
- Fails if the map overwhelms the user with thousands of nodes at startup.
- Fails if chat slows down because of the dashboard (streaming is not broken).

## 5. Constraints

- Windows first; the speech recognition binary is downloaded with user consent
  (~150 MB model).
- Turkish speech synthesis: if the machine has no Turkish SAPI voice (today
  there is only en-US Zira) the app says so and gives installation instructions;
  it does not read broken Turkish.
- The existing permission classifier is preserved: new tools also fall into the
  `simple/important` class, "unknown = important".
- All new endpoints go through token + Origin checks.

## 6. Approaches (selected)

### 6.1 Simulation → **World model + action history** (chosen)
Typed facts + computation. The alternative (simulated preview) was rejected by
the user: it requires writing a second model for every tool, doubling the work.

### 6.2 Voice → **Local whisper + local speech synthesis** (chosen)
The alternative (browser Web Speech) sends audio to Google and is unreliable in
Electron.

### 6.3 Map → **Collapsible regions** (chosen)
The alternative (force-directed clustering) is messy on large data.

### 6.4 Dashboard → the only sensible path
Dashboard is the main screen, chat in the center. No alternative.

## 7. Design

### 7.1 Dashboard (new main screen)

```
┌───────────────────────────────────────────────────────────────────┐
│ JARVIS-style header: KAREN · status · date/time · search · alerts  │
├──────────┬─────────────────────────────────┬──────────────────────┤
│ sidebar  │  CORE (chat)                    │ live feed            │
│ Dashboard│  sphere in the middle, command  │ (alert/event)        │
│ Chat     │  line + mic button beneath it   │                      │
│ Agents   ├─────────────────────────────────┤                      │
│ Memory   │  agents · timeline ·            │                      │
│ Map      │  memory summary · provider      │                      │
│ Voice    │                                 │                      │
│ Settings │                                 │                      │
├──────────┴─────────────────────────────────┴──────────────────────┤
│ bottom bar: sessions · approval badge · connection · microphone    │
└───────────────────────────────────────────────────────────────────┘
```

- Core area = the existing chat component (no new chat is written).
- Sphere: rings spinning in CSS; status color (idle/running/error).
- Panels are read-only; clicking takes you to the relevant screen.
- `GET /api/dashboard` returns a summary in a single request (sessions, recent
  events, memory counts, pending approval, provider, voice status) — so the
  dashboard does not fire 10 separate requests.

### 7.2 World model (`server/memory/world.ts`)

Tables (a presentation layer, the source is always the event log):
- `world_facts(id, entity, attribute, value_num, value_text, unit, kind, valid_from,
  source_event, confidence)` — `kind`: `number|date|duration|money|text|boolean`
- `world_actions(id, tool, target, outcome, status, started_at, finished_at, source_event)`
- `world_entities(id, name, kind)` — project, person, file, server, job.

Writing: the distillation pipeline gains new roles (deterministic first):
- **Number/date extractor:** from the text `500 TRY`, `03:00`, `2 hours`,
  `21.10.2026`, `15%`. Only a value that appears verbatim in the source event is
  written (fabrication is forbidden).
- **Action writer:** every `tool_call`/`tool_result` pair lands in
  `world_actions` (what was done, did it succeed, how long it took).
- **Entity linker:** project/folder names into `world_entities`.

Query (tools):
- `world_query {entity?, attribute?, since?, until?}` → typed rows
- `world_compute {op, attribute, entity?}` → `sum | count | latest | earliest | next | avg`
  Deterministic; works even without a model.
- `world_history {limit}` → recent actions (what was done, its outcome).

Evidence rule: every row carries `source_event`; a row without evidence is
rejected. A number must appear verbatim in the source text (the same as the
existing evidence gate).

### 7.3 Regional map (`server/memory/map.ts` + `app/src/components/BrainMap.tsx`)

`BrainMap` now returns `regions`:

```
Region = { id, kind:'project'|'layer'|'concept', label, count, weight, nodeIds, x/y/w/h }
```

- Region = project (project key), layer (memory/knowledge) or a dense concept
  cluster.
- The UI initially draws **only region boxes** (name + counter + weight).
- Click a box → only that region's nodes open (`openRegionId`), the others stay
  closed.
- "Close all", breadcrumb, Esc = close.
- A conflicting note is visible in every state (one awaiting a decision is not
  hidden).
- Zoom still increases detail, but the **scope** is region selection, not zoom.

### 7.4 Voice (`server/voice/`)

- **Recognition:** `whisper.cpp`. Binary `~/.karen/voice/bin/whisper-cli(.exe)`,
  model `~/.karen/voice/models/ggml-base.bin`. Installation with user consent:
  `npm run karen -- voice-setup` (downloads, verifies) or "Set up voice" in the
  UI.
- The UI records 16 kHz mono with `MediaRecorder` → `POST /api/voice/transcribe`
  (token-checked, 20 MB limit) → the server writes a temp file and runs whisper
  → text. The temp file is deleted when the job is done.
- **Speech synthesis:** `POST /api/voice/speak {text, lang}` → local SAPI
  (PowerShell `System.Speech`). If there is no Turkish voice,
  `{ok:false, reason:'no-voice'}` and the UI falls back to `speechSynthesis`; if
  that is missing too, it continues in writing.
- **Mode:** voice state `idle|listening|thinking|speaking`. When the chat answer
  ends, automatic speech synthesis (turned on/off in settings).
- Tool: `speak {text}` (not `important`, `read`) → the model can speak.
- Privacy: the recording does not leave the device; no cloud. If whisper is
  missing it shows as "not installed".

### 7.5 Computer access (new tools)

`open_app {name}` (shell `start`), `screenshot {}` (screenshot file),
`clipboard_read {}`, `clipboard_write {text}`, `media_control {action}`,
`window_focus {title}`. Classes: `open_app`/`window_focus`/`media_control`
important; `clipboard_read` important (can leak data); `screenshot` important
(the screen carries secrets); `clipboard_write` simple (we are writing our own
data).

## 8. Phases (in order, each works on its own)

1. **Dashboard:** `/api/dashboard`, new screen, chat in the center, live panels.
2. **World model:** tables, extractors, `world_*` tools, tests.
3. **Regional map:** `regions`, collapsible regions, UI.
4. **Voice:** whisper setup/detector, transcribe/speak endpoints, mic button,
   automatic speech synthesis.
5. **Computer tools:** app/screen/clipboard/media/window.

## 9. Verification

- Dashboard: single-request summary; panel numbers match the API; chat
  streaming is not broken.
- World model: a row without evidence is rejected; `sum` only sums its own rows;
  `next` does not return a past date; a number not in the source is not written.
- Map: only regions at startup; when one region opens the others are closed; a
  conflict is visible in every state; with 500 notes the box count is reasonable
  (≤ 20).
- Voice: without whisper, transcribe returns 503 + a clear message, the app
  still runs; the audio file is deleted after the job; without a Turkish voice,
  speak returns `no-voice` and writing continues.
- Computer: every new tool asks for approval in the `important` class (except
  clipboard_write).

## 10. Risks

- **Whisper download/build:** user wait if there is no ready binary. Mitigation:
  installation is a separate command, the app runs without it.
- **No Turkish voice:** today only en-US Zira. Mitigation: explicit warning +
  installation instructions.
- **World model noise:** assuming every number is real. Mitigation: only values
  present in the source, an `attribute` allowlist (price, duration, date, time,
  amount, percentage, count).
- **Dashboard performance:** panel data is refreshed every 5 s; delta instead of
  a full update.
- **Scope:** four large pieces; if the order is not kept, none of them finishes.

## 11. Left to the builder

- Dashboard CSS details, sphere animation, panel layout.
- Download URLs and version pinning of the whisper setup script.
- The full list of `world_*` table columns and indexes.
- Region box layout algorithm (packing).

## 12. Implementation notes (clarified during the build)

- **whisper binary:** whisper.cpp's Windows archives do not contain
  `whisper-cli.exe`; `main.exe` is deprecated and does not accept `--port`.
  Therefore only `whisper-server.exe` is used (side process, HTTP `/inference`).
  The binary address is resolved at runtime from the GitHub API; if the pinned
  tag returns 404 it falls back to a backup.
- **Audio format:** the browser recording is decoded with `AudioContext` and
  converted to 16 kHz mono 16-bit WAV; there is no ffmpeg on the server.
- **Turkish boundaries:** because JS `\b` does not treat Turkish letters as word
  characters, `(?![a-zçğıöşü])` is used in attribute and negation patterns.
- **Mixed type rule:** if a sentence contains more than one type (money +
  percentage + duration), the sentence's heading is not written to any of them;
  otherwise `sum` would produce a fabricated total. If the total sees a
  different type/unit it returns no value ("ambiguous").
- **A write tool without a path** cannot be considered inside the root: it asks
  for approval (including dashboard writes).
- `next` returns only a future record; if there is a past date, "no record in
  the future".
