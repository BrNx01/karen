<div align="center">

<img src="electron/icon.png" alt="KAREN" width="132">

# KAREN

**A local agent hub with a second brain.**

<p>
  <a href="https://github.com/BrNx01/karen/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/BrNx01/karen/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/BrNx01/karen/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/BrNx01/karen?color=e11d2e"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-e11d2e"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows-e11d2e">
  <img alt="providers" src="https://img.shields.io/badge/providers-18-e11d2e">
  <img alt="tests" src="https://img.shields.io/badge/tests-770-e11d2e">
  <img alt="interface" src="https://img.shields.io/badge/interface-English%20%7C%20Türkçe-e11d2e">
</p>

<p>
  <a href="https://brnx01.github.io/karen/">Website</a> ·
  <a href="https://github.com/BrNx01/karen/releases/latest">Download</a> ·
  <a href="https://github.com/BrNx01/karen/issues">Issues</a>
</p>

</div>

---

KAREN runs on your machine and stays there. It is not a chat box with a tool
button: the **brain** talks to you, **sessions** do the work, and a **memory**
that thickens with use decides what comes back next time. You pick the model —
local or cloud — and every side effect passes a permission gate.

```bash
git clone https://github.com/BrNx01/karen.git && cd karen
npm install && npm run build
npm run karen -- serve      # prints a tokenised 127.0.0.1 URL
```

Or install the Windows build and skip the terminal:
[**KAREN-Setup-1.0.0.exe**](https://github.com/BrNx01/karen/releases/latest).

## Why KAREN

- **It remembers like a brain, not a vector store.** Episodes, facts and skills
  live in separate layers on an FSRS curve: repetition strengthens, disuse
  fades, **nothing is silently deleted**. Trauma-marked notes never go dormant.
- **It computes instead of guessing.** Budgets, durations, dates and clock times
  are kept as typed facts with validity windows, so "how much is left in March"
  is a query, not a recollection.
- **It does the work in its own sessions.** Ask for a job and the brain spawns a
  worker with its own context, streams the result back, and keeps the main
  conversation clean.
- **It is honest about cost and risk.** Approval cards say what will run, paid
  sleep is off unless you enable it, and autonomy spends nothing until you turn
  it on.
- **It is bilingual without being half-translated.** The interface switches
  between English and Turkish instantly; KAREN still answers in whatever
  language you write in.
- **It stays yours.** The event log, memory and keys live in
  `%APPDATA%\KAREN\karen-data` (or `~/.karen`). The server listens on
  `127.0.0.1` only and requires a token.

## A session, end to end

```text
you ›  remember the rent goes up in March, and ask me the day before
karen › noted — valid from 2026-03-01, reminder the day before.

you ›  what did the workshop cost me last month?
karen › 4,200 across three payments; the last one on Oct 24 was 1,200.

you ›  why did the build fail this morning?
       ┌─ approval ────────────────────────────────────────────┐
       │ run_command: git log --oneline -5                     │
       │ reads only · inside the project root                  │
       └──────────────────────────── approve · reject ──────────┘

you ›  hey karen
karen › listening.
```

Say it, type it, or leave it alone: when you are away it can research on its own
and leave **one** line in the inbox.

## Install

### Windows installer (recommended)

1. [Releases](https://github.com/BrNx01/karen/releases/latest) →
   `KAREN-Setup-1.0.0.exe`
2. Install and open. It updates itself from then on.

> The installer is **unsigned**, so Windows warns about an unknown publisher:
> *More info → Run anyway*. Code signing removes that warning.

> Coming from the earlier build of this project? On first run KAREN **copies** the
> old profile — memory, event log, settings, keys — and leaves the original
> folder untouched.

### From source

```bash
git clone https://github.com/BrNx01/karen.git
cd karen
npm install
npm run build
npm run desktop            # Electron shell
npm run karen -- serve     # or: headless server + any browser
```

Requires Node 20+ and Windows for the packaged build (the server itself is
plain Node).

### Local voice (optional)

```bash
npm run karen -- voice-setup --yes    # whisper.cpp + ggml-base, ~150 MB
```

Recognition runs locally; audio only ever reaches `127.0.0.1`.

## First run

Settings → **Provider**:

| Choice | Notes |
|---|---|
| Ollama · LM Studio · llama.cpp · vLLM | local, no key, works offline |
| Anthropic · OpenAI · Google | cloud, key required |
| Groq · Cerebras · DeepSeek · Mistral · OpenRouter · Together · xAI · Fireworks · Perplexity | OpenAI-compatible, one click |
| Azure OpenAI | endpoint + deployment + api-version |
| Custom | any OpenAI-compatible endpoint |

Keys go to `~/.karen/secrets.json` (never shown again) or are read from
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. **With no key at all KAREN falls back to
a local model** — it never refuses to start.

## Daily use

| Panel | What it is for |
|---|---|
| **Command Center** | the core orb, live feed, agents, recent actions, system gauges |
| **Chat** | conversation, voice input, wake phrase |
| **Inbox** | what KAREN did or noticed while you were away |
| **Memory** | notes by layer, conflicts to resolve, consolidation ("sleep") |
| **Brain Map** | continents (projects) → cities (concepts) → streets (notes) |
| **Skills** | `SKILL.md` imports, two-stage loading |
| **Growth** | proposals the brain wants to make; you approve, `git revert` undoes |
| **Repos** | projects KAREN is allowed to touch |
| **Settings** | provider, voice, language, autonomy, secrets |

Commands:

```text
karen serve                 headless server, prints a tokenised URL
karen run "<task>"          one-shot agent run in the current directory
karen sleep [--data <dir>]  consolidate memory now
karen rebuild [--data <dir>] rebuild memory projections from the event log
karen voice-setup --yes     download whisper and a base model
```

`npm run karen -- <command>` works too.

## Memory

Layered the way recall actually behaves:

- **Working context** → **episodes** → **facts** → **skills** → **cold storage**.
- **Dual strength:** storage never decreases, retrieval fades; the FSRS curve
  decides when a note surfaces.
- **Hebbian links:** two memories recalled in the same turn thicken their link;
  unused links thin over a 30-day half-life but never reach zero.
- **Intuitions:** old, well-consolidated notes add a one-line weight hint
  (concepts, confidence, caution, source ids) instead of more prose.
- **Evidence rule:** a distilled note must cite the event ids that support it.
  No citation, no note. Secrets are never written.
- **Sleep** distils the day, merges duplicates, and marks conflicts for you.

## Autonomy

Off until you enable it (Settings → Autonomy). When you have been idle past the
threshold, KAREN opens a **restricted** session: read-only tools, network reads
only, no approval requests, nothing installed or executed. It distils what it
learned in the same tick and leaves exactly one inbox line. Closing the app stops
all of it.

## Safety model

- Server bound to `127.0.0.1`, token required, Origin checked.
- **Permission gate:** reads are free, writes stay inside the project root;
  deletion, network, interpreters (`node -e`, `npm test`, `python -c`),
  `git push` and command chaining ask first.
- An **unknown** command always asks. The model's opinion that it is harmless
  does not count.
- Automatic approvals are logged and labelled "approved by the brain" in the UI.
- **Core identity is read-only**: edits are reverted on load, and the
  self-improvement system cannot even propose changes to it.
- Protected surfaces (permissions, approval path, settings, tests, shell) can
  never be proposed; changes are compiled and tested in a temp copy before they
  reach you, and land as one revertible commit.
- Voice audio never leaves the machine.

## Architecture

```text
server/
  engine/        agent loop, tools, provider adapters, permission classifier
  memory/        layers (FSRS), distillation, sleep, world model, map
  brain/         state vector, preferences, reflex (amygdala), read-only core
  autonomy/      idle clock, DMN scheduler, drives, inbox, shadow mode
  store/         append-only event log (hash chain)
  http/          HTTP + WebSocket, approval broker, localisation
  voice/         local whisper + speech output
  growth/        self-improvement proposals
  sessions.ts    brain / worker sessions, notifications
shared/i18n/     one dictionary for the interface and the server
app/             React interface (Vite)
electron/        desktop shell, updater
site/            landing page (GitHub Pages)
docs/            design records and implementation plans
```

## Development

```bash
npm test               # 770 tests
npm run build          # server (tsc) + interface (vite)
npm run desktop        # run in Electron
npm run dist           # Windows installer → release/
```

Releasing: bump `version`, `git tag v1.0.0 && git push --tags`. CI builds the
installer, rebuilds the native module for Electron, and publishes it; installed
apps pick the update up by themselves.

Before a change: `npm test` and `npx tsc -p tsconfig.json --noEmit` must pass.

## Documentation

- [Design records and plans](docs/superpowers/) — how each phase was built and why
- [Glossary](docs/GLOSSARY.md) — the terminology the code and docs use
- [Changelog](CHANGELOG.md) — what shipped in 1.0.0

## Contributing

Open an [issue](https://github.com/BrNx01/karen/issues) for bugs and ideas. Keep a
change focused, run the tests, and say what you verified.

## License

[MIT](LICENSE). KAREN is released by its contributors, with no warranty — an
agent that can run commands is a tool, and the permission gate is there to be
read.
