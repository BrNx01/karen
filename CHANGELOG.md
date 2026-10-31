# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
