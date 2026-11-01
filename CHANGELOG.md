# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-11-01

The dashboard becomes a cockpit: an empty stage with the core, and a dock you open on
demand.

### Added

- **Empty stage** — the core sits alone in the middle: the mark, a tick bezel, two
  counter-rotating rings, one status line, two actions.
- **A dock, not a dashboard** — five small icons on the right edge. Each grows under the
  pointer and shows its name; clicking opens its panel beside the core. Clicking again,
  or `Esc`, closes it. Conversation, memory, system, inbox and agents are panels now,
  not permanent columns.
- **Clear screen** hides the dock as well, leaving the orb and the composer.
- **The screen reacts when it matters** — a reply in flight or a waiting approval opens
  the conversation panel on its own, once, and never over an open panel.
- **Panels with real content** — memory bars and counts, CPU/RAM/heap dials with the live
  feed, unread inbox, the session list, and the conversation with approval cards.

### Changed

- Removed the four-quadrant dashboard grid, the always-on side cards and their focus
  animation. The room stays empty until it is asked for.
- One palette, one place: `polish.css` no longer redefines `--muted`, `--accent` and
  friends, which had turned every muted label red.
- Chat has its own stylesheet: bubbles with a spine, a proper empty state, and approval
  cards that read like part of the conversation.
- The shell collapses its own context panel below 1080 px, so the cockpit keeps its width.

### Fixed

- A truncated `electron/updater.cjs` (from 1.0.0) that made the packaged app fail to
  load, and the missing native-module rebuild before packaging.

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
