# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-11-01

The command center becomes a cockpit: one screen, three live cards, and a layout that
gets out of the way.

### Added

- **Cockpit layout** — core / memory / system cards on the left, the core in the middle,
  the conversation on the right. Replaces the four-quadrant dashboard.
- **Cards that answer back** — when KAREN writes memory, changes state or runs a tool,
  the card that explains it steps forward for four seconds and the others fade back.
- **Collapsible everything** — an edge handle per panel, plus *clear the screen* (zen),
  which hides both and leaves the core and composer alone. The layout is stored and
  restored on the next launch.
- **Five core actions** — talk, consolidate now, inbox, growth, clear the screen — with
  live badges for unread notes and pending proposals.
- **Real gauges** — CPU, RAM and heap dials plus turns/tools/conflicts/approvals, all from
  the process, none invented.

### Changed

- The dashboard component is gone; the cockpit is the overview now. Memory, Inbox, Map,
  Skills, Growth, Repos and Settings keep their own screens.
- Panel toggles are always visible at 55 % opacity: a control hidden until hover is a
  control nobody finds.

### Fixed

- Collapsing a panel used to remove the only button that could reopen it; a collapsed
  panel now leaves an edge handle.
- The first event on load no longer steals focus from a card: only new events do.

## [1.1.0] — 2026-11-01

A redesign rather than a feature drop: the app now looks and behaves like the thing it
claims to be, and the first five minutes no longer require a manual.

### Added

- **New shell** — an icon rail, one stage, a contextual panel for approvals and agents,
  and a composer that never scrolls away. Collapses to a bottom bar below 900 px.
- **Arc-reactor icon** — one geometry source (`scripts/make-icon.mjs`) renders the app
  icon, the site mark and the README mark, so they cannot drift.
- **Settings as a control room** — eight sections (Model, Voice, Computer, Memory,
  Autonomy, Interface, Setup, Advanced). A control ships only if something reads it.
- **One-address provider detection** — paste an address, paste a key, press Detect:
  KAREN infers the protocol, asks the endpoint for its models, and lists them with
  context sizes. Two custom endpoints keep separate configs and keys.
- **EVREN (SSB)** as a first-class provider preset.
- **Offline neural voice** — Piper on the CPU with two female voices
  (`tr_TR-dfki-medium`, `en_GB-alba-medium`), cached, adjustable speed, played server-side
  so it works with the window closed. Downloaded and hash-verified on first run,
  resumable, skippable; the OS voice remains a fallback, not the default.
- **Direct computer control** — `mouse_move`, `mouse_click`, `scroll`, `type_text`,
  `press_keys`, `window_list`, `window_focus`, with `ui_tree`/`ui_invoke` for
  accessibility-element targeting. Three modes: off, ask, allow.
- **Screenshot reading** for vision models.
- **Demo profile and real captures** — `scripts/demo-profile.mjs` seeds a throwaway
  profile; `scripts/capture.mjs` photographs the built app from Electron's offscreen
  renderer, so the README shows real pixels without a real memory.

### Changed

- Palette is quieter: near-black surfaces, one accent, the data hue reserved for charts.
  Gradients and shadows removed except on the core orb.
- Every glyph is a hand-drawn SVG; the interface contains no emoji.
- Turkish runtime strings are now English; the interface dictionary does the translating.
- The README is rebuilt around real screenshots, honest claims and a short download path.

### Security

- Computer actions ask by default. `allow` still asks for typed credentials (by shape and
  by matching a stored secret) and for closing or moving a window.
- A turn stops after 30 input actions; `Ctrl+Alt+K` stops KAREN from anywhere, including
  with the window hidden.
- Autonomous sessions never receive the computer tools.
- The voice downloader verifies every file against a pinned SHA-256 and retries once.

### Fixed

- The updater module was truncated in 1.0.0, so the packaged app died on launch.
- Native modules are rebuilt for Electron before packaging, so the installed app starts.
- `ctrl+shift+t` pressed only the modifiers: letter and digit virtual keys were missing.

## [1.0.0] — 2026-10-31

First public release. A local agent hub with a second brain, published as **KAREN** (the project
was developed under a working name; the history was restarted for this release).

### Added

- **Command center** — one page: navigation, a three-column dashboard with the core orb, live
  feed, agents, recent actions, system gauges, memory insight and model state.
- **Bilingual interface** — English and Turkish, switchable in Settings without a restart.
  KAREN always answers in the language you write in; the model always receives English
  instructions.
- **Inner state** — cortisol, dopamine, serotonin, fatigue and a circadian phase, recomputed
  every turn from the event log. It changes the prompt gates (crisis, R&D, consolidation,
  fatigue, night) and the sampling temperature.
- **Biological memory** — FSRS curve with dual strength (storage never decreases, retrieval
  fades), Hebbian links that thicken with use and thin with disuse (30-day half-life, floor
  0.05, never deleted), trauma notes that never go dormant, and intuitions: old well-consolidated
  memories surface as a weight line (concepts, confidence, caution, source ids) instead of prose.
- **Bi-temporal world model** — typed facts (money, duration, date, time, rate) with `valid_to`
  and `superseded_by`; a new fact ends the old one instead of overwriting it, and past states
  stay queryable with `asOf`.
- **Autonomy** — off by default. When idle it opens a restricted session, researches, distils
  the transcript in the same tick, and leaves one inbox line. Read-only tools, network reads
  only, never waits for approval, stops when the app closes.
- **Amygdala reflex** — memory pressure or the same side-effecting tool call three times in a
  row is handled without asking the model: the oldest worker is stopped or the turn is cut
  before approval and execution.
- **Read-only core identity** — a fixed character sheet loaded first in every prompt; edits are
  reverted on load and the self-improvement system cannot propose changes to it.
- **Metacognition** — preferences are counted from real user messages only; a term needs three
  distinct messages and a preference cue, and is offered once, at fifteen observations.
- **Brain map** — one canvas with semantic zoom: continents (projects) → cities (concepts) →
  streets (notes). Layout is computed once over all nodes, so zoom never moves a node.
- **Voice** — local whisper recognition, browser speech output, “hey karen” wake phrase.
- **Automatic updates** — GitHub Releases through `electron-updater`, with a restart prompt.
- **Landing page** — GitHub Pages, red-on-black.

### Security

- The permission gate requires approval for interpreters, package runners, network access and
  git writes; an unknown command always asks.
- The autonomous session cannot use write or exec tools, and its network access is read-only
  (GET/HEAD, no body).
- Generated proposals are path-canonicalised and re-validated at apply time; traversal (`..`),
  Windows alternate data streams (`:`) and non-canonical spellings are rejected. The core
  identity and its enforcement code are protected surfaces.
- Memory evidence rule: a note without a supporting citation is rejected; a note citing a URL
  must have that URL verbatim in the cited tool output.
- Session aborts answer every outstanding tool call, so a cancelled turn never poisons the next
  one.
- Voice audio never leaves the machine; a non-Turkish voice is never used to read Turkish text.

### Notes

- The installer is **unsigned**; Windows shows an “unknown publisher” warning.
- Code proposals only work in a source checkout; the packaged app is read-only.
- Autonomy is off by default — no tokens are spent in the background until you enable it.
