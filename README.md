<div align="center">

# KAREN

**Local agent hub and second brain — a JARVIS-style command center**

Talk, type, delegate. KAREN runs on your machine, learns who you are, remembers, and does the work.

[![CI](https://github.com/BrNx01/karen/actions/workflows/ci.yml/badge.svg)](https://github.com/BrNx01/karen/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/BrNx01/karen)](https://github.com/BrNx01/karen/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-red)](LICENSE)
[![English](https://img.shields.io/badge/lang-English%20%7C%20Türkçe-e11d2e)](https://github.com/BrNx01/karen)

[Website](https://brnx01.github.io/karen/) · [Download](https://github.com/BrNx01/karen/releases/latest) · [Issues](https://github.com/BrNx01/karen/issues)

</div>

---

## What it is

KAREN is not a cloud chat box with a nice prompt. It is an **agent runtime** you own:

- **The brain** talks to you; **sessions** do the work. When a job needs its own context, the
  brain opens a background session and brings the result back.
- **Memory** is layered like a real one: working context, episodes, facts, skills, cold storage.
  Repetition strengthens, disuse fades — and nothing is deleted silently.
- **A world model** keeps typed facts (money, durations, dates, clock times) and computes over
  them instead of guessing.
- **Real computer access**: files, shell, launching apps, screenshots, clipboard, media — every
  call passes a permission gate.
- **Local voice**: you speak, it answers out loud. Your audio never leaves the machine.

## Features

| | |
|---|---|
| 🎙 **Voice** | Local whisper recognition, browser speech output, “hey karen” wake phrase |
| ◈ **Memory** | FSRS curve + dual strength (storage/retrieval), surprise weighting, cold storage |
| 🧮 **World model** | Bi-temporal facts: “true now” and “what was true in March” |
| 🖥 **Computer** | `read_file`, `write_file`, `run_command`, `open_app`, `screenshot`, `clipboard_*`, `media_control`, `window_focus` |
| ◆ **Orchestration** | `spawn_session`, `session_status/send/cancel`, notification queue, concurrency limit |
| ☾ **Autonomy** | Learns while you are away: researches when idle, distils into memory, leaves one inbox line — **off by default** |
| ✦ **Skills** | Import `SKILL.md` from outside repos, two-stage loading |
| ❖ **Map** | One canvas: continents (projects) → cities (concepts) → streets (notes); zoom changes visibility only, never node positions |
| ↗ **Self-improvement** | The brain **proposes** changes; you approve; `git revert` undoes them |
| ◉ **Inner state** | Cortisol, dopamine, serotonin and fatigue drive tone, sampling temperature and context budget |
| ↻ **Updates** | Automatic download from GitHub Releases, restart prompt |

## Install

### Packaged app (recommended)

1. [Releases](https://github.com/BrNx01/karen/releases/latest) → `KAREN-Setup-1.0.0.exe`
2. Install and open. The app updates itself from then on.

> The installer is **unsigned**. Windows shows a “unknown publisher” warning; continue with
> “More info → Run anyway”. Code signing will remove that warning.

> Coming from the earlier build of this project? KAREN copies the old profile once on first
> run — memory, event log, settings and keys — and leaves the original folder untouched.

### From source

```bash
git clone https://github.com/BrNx01/karen.git
cd karen
npm install
npm run build
npm run desktop        # run in Electron
# or
npm run karen -- serve # open the URL it prints in your browser
```

## Choosing a model

Settings → **Provider**:

| Provider | Notes |
|---|---|
| Ollama · LM Studio · llama.cpp · vLLM | Local, no key, works offline |
| Anthropic · OpenAI · Google | Cloud, key required |
| Groq · Cerebras · DeepSeek · Mistral · OpenRouter · Together · xAI · Fireworks · Perplexity | OpenAI-compatible, one click |
| Azure OpenAI | endpoint + deployment name + api-version |
| Custom | any OpenAI-compatible endpoint |

Keys live in `~/.karen/secrets.json` (never shown again in the UI) or are read from
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. **With no key the app falls back to a local model** —
it never refuses to start.

The interface is bilingual (English / Turkish) and switches in Settings. That setting only
changes the UI: KAREN always answers in the language you write in.

## Voice

```bash
npm run karen -- voice-setup --yes    # whisper.cpp + ggml-base (~150 MB)
```

- Recognition is **local**: audio only goes to `127.0.0.1`, the model runs on your machine.
- Speech output runs in the browser and uses your OS voices.
- “hey karen”: Settings → Speech. Off by default, because some browsers run speech
  recognition in the cloud.

## Autonomy

Off until you turn it on (Settings → Autonomy). When enabled and you have been idle for the
configured threshold, KAREN opens a restricted session: read-only tools, network reads only,
never asks for approval, never installs or runs anything. It distils what it learned into
memory and leaves exactly one line in the inbox. Closing the app stops all of it.

## Safety model

- The server listens on `127.0.0.1` only, with a token and an Origin check.
- **Permission gate:** reads are free; writes stay inside the project root; deletion, network,
  interpreters (`node -e`, `npm test`, `python -c`), `git push` and command chaining → approval.
- An unknown command **always** asks (a model's opinion that it is harmless does not count).
- Automatic approvals are logged and shown in the UI as “approved by the brain”.
- Memory evidence rule: a distilled note must cite the event ids that support it; notes without
  a citation are rejected, and secrets (keys, passwords) are never written.
- The **core identity is read-only**: edits to `brain/core/core_identity.md` are reverted on the
  next load, and the self-improvement system cannot even propose changes to it.
- Self-improvement: protected surfaces (permissions, approval path, settings, tests, shell) can
  never be proposed; changes are compiled and tested in a temporary copy before they reach you,
  and applied as a single commit you can revert.

## Architecture

```
server/
  engine/        agent loop, tools, provider adapters, permission classifier
  memory/        memory layers (FSRS), distillation pipeline, sleep, world model, map
  brain/         state vector, preferences, reflex (amygdala), read-only core
  autonomy/      idle clock, DMN scheduler, drives, inbox, shadow mode
  store/         append-only event log (hash chain)
  http/          HTTP + WebSocket, approval broker, localisation
  voice/         local whisper + speech output
  growth/        self-improvement proposals
  sessions.ts    brain/worker sessions, notifications
shared/i18n/     one dictionary for the UI and the server
app/             React interface (Vite)
electron/        desktop shell, updater
site/            landing page (GitHub Pages)
docs/            design documents and plans
```

## Development

```bash
npm test              # 770 tests
npm run build         # server + interface build
npm run desktop       # run in Electron
npm run dist          # Windows installer (release/)
```

Releasing: `git tag v1.0.0 && git push --tags` → CI builds the installer and publishes it to
Releases; installed apps update themselves.

## Contributing

Open an [issue](https://github.com/BrNx01/karen/issues) for bugs and ideas. Before sending a
change, `npm test` and `npx tsc --noEmit` must pass.

## License

[MIT](LICENSE)
