import { randomBytes } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { totalmem } from 'node:os';
import { ApprovalBroker } from './http/approvals.js';
import { createKarenServer, type EventHub, type KarenServer } from './http/server.js';
import { RepoStore } from './repos.js';
import { SessionManager } from './sessions.js';
import { SkillStore } from './skills.js';
import { EventLog } from './store/events.js';
import { loadIdentity } from './memory/identity.js';
import { MemoryStore } from './memory/notes.js';
import { sleep, type SleepReport } from './memory/sleep.js';
import { providerDistiller, sleepDistiller } from './memory/distiller.js';
import type { Distiller } from './memory/distill.js';
import { WorldModel } from './memory/world.js';
import { StateStore } from './brain/store.js';
import { PreferenceStore } from './brain/preferences.js';
import { buildDashboard } from './dashboard.js';
import { buildIntuitions } from './memory/intuition.js';
import { detectVoice, speak, LocalWhisper, isWav, type VoiceInfo } from './voice/index.js';
import { SettingsStore, type Settings } from './settings.js';
import { buildProvider, SwitchableProvider } from './engine/switchable.js';
import { ProposalStore } from './growth/store.js';
import { existsSync } from 'node:fs';
import type { Provider } from './engine/types.js';
import { IdleClock, greetingLine, shouldGreet } from './autonomy/activity.js';
import { message } from './http/locale.js';
import { InboxStore } from './autonomy/inbox.js';
import { Dmn } from './autonomy/dmn.js';
import { unknownTermsFrom } from './autonomy/drives.js';
import { knownRequirements, shadowReport } from './autonomy/shadow.js';
import { projectKey } from './project.js';
import { profileDir } from './migration.js';
import { reflexMonitorState, reflexTick } from './brain/reflex-monitor.js';

export type ServeOptions = {
  port?: number;
  provider?: Provider;
  model?: string;
  dataDir?: string;
  cwd?: string;
  token?: string;
  /** Root of the UI files (app.getAppPath() in the packaged app). */
  rootDir?: string;
  /** Whether code proposals are enabled (off in the packaged app, decision 12.1). */
  codeEditsEnabled?: boolean;
  /** LLM bridge for sleep and DMN; when absent, production uses the active provider. */
  distiller?: Distiller;
  /** Used in tests to drop the idle threshold to 0; normally it comes from settings. */
  autonomyIdleMinutes?: number;
};

/** The packaged app runs from inside app.asar: no git/tsc. */
const appIsPackaged = existsSync(join(process.execPath, '..', 'resources', 'app.asar'));

const MB = 1024 * 1024;
const REFLEX_MONITOR_MS = 30_000;

export type RunningServer = KarenServer & {
  token: string;
  url: string;
  memory: MemoryStore;
  state: StateStore;
  settings: SettingsStore;
  sleep(): Promise<SleepReport>;
  autonomy: {
    touch(): void;
    stop(): void;
    /** A single attempt (in tests, without waiting for the timer); in production the timer calls it. */
    tick(now?: number): { ran: boolean; reason?: string };
    stats(): { runsToday: number; lastRunAt: number | null; lastError: string | null };
  };
  close(): Promise<void>;
};

export async function startKarenServer(opts: ServeOptions = {}): Promise<RunningServer> {
  const dataDir = opts.dataDir ?? profileDir();
  const token = opts.token ?? randomBytes(24).toString('hex');
  const codeEditsEnabled = opts.codeEditsEnabled ?? !appIsPackaged;
  const log = new EventLog(join(dataDir, 'events.db'));
  const repos = new RepoStore(join(dataDir, 'repos.json'));
  const skills = new SkillStore(join(dataDir, 'skills'));
  const memory = new MemoryStore(log);
  const world = new WorldModel(log, memory);
  const state = new StateStore(log);
  const preferences = new PreferenceStore(dataDir);
  const growth = new ProposalStore({
    dataDir,
    repoRoot: process.cwd(),
    codeEditsEnabled,
  });
  const approvals = new ApprovalBroker();
  const hub: EventHub = { send: () => undefined };
  const settingsStore = new SettingsStore(dataDir);
  const inbox = new InboxStore(log);
  const idle = new IdleClock(() => Date.now());
  let voiceCache: VoiceInfo | null = null;
  const whisper = new LocalWhisper({ dataDir });

  // The provider is built from settings; an injected one (tests) always wins.
  const initialSettings = settingsStore.get();
  let built;
  try {
    built =
      opts.provider !== undefined
        ? { provider: opts.provider, label: 'injected' }
        : buildProvider(initialSettings, (id) => settingsStore.apiKey(id));
    loadIdentity(dataDir);
  } catch (err) {
    log.close();
    throw err;
  }
  const model = opts.model ?? initialSettings.model;
  const provider = new SwitchableProvider(built.provider, model);

  // Sessions read this object live; when the setting changes, the research permission changes with it.
  const autonomyGate = { research: initialSettings.autonomy.research };

  const applySettings = (next: Settings): void => {
    autonomyGate.research = next.autonomy.research;
    if (opts.provider === undefined) {
      const rebuilt = buildProvider(next, (id) => settingsStore.apiKey(id));
      provider.swap(rebuilt.provider, next.model || 'default');
    } else if (next.model !== '') {
      provider.swap(built.provider, next.model);
    }
  };

  const sleepAllowed = opts.distiller !== undefined || settingsStore.get().allowPaidSleep;
  const distiller =
    opts.distiller ??
    sleepDistiller({ ...process.env, ...(sleepAllowed ? { KAREN_SLEEP_ALLOW_PAID: '1' } : {}) }, undefined, model);

  // DMN distills with the ACTIVE provider on every turn: the sleep bridge would look at
  // KAREN_PROVIDER and fall back to ollama under an Anthropic/OpenAI setup. Leaving autonomy
  // on is explicit consent to spend background tokens (decision record).
  const dmnDistiller = opts.distiller ?? providerDistiller(provider, 'default');

  const runSleep = async (): Promise<SleepReport> => {
    const report = await sleep(log, memory, { dataDir, ...(distiller ? { distiller } : {}) });
    world.syncFromLog(0);
    return report;
  };

  const currentSettings = (): Settings => settingsStore.get();

  const sessions = new SessionManager({
    provider,
    model,
    log,
    skills,
    memory,
    world,
    state,
    growth,
    preferences,
    codeEditsEnabled,
    dataDir,
    identity: () => loadIdentity(dataDir),
    onEvent: (event) => hub.send(event),
    approve: (sessionId, req) => approvals.ask(sessionId, req, (msg) => hub.send(msg)),
    allowCwd: (cwd) => {
      const target = resolve(cwd).toLowerCase();
      return repos.list().some((repo) => {
        const root = resolve(repo.path).toLowerCase();
        return target === root || target.startsWith(root + sep);
      });
    },
    maxBackground: currentSettings().maxBackground,
    autonomy: autonomyGate,
    // Shadow mode: reads only the manifest, leaves a single line; runs no commands.
    onSessionStart: ({ cwd }) => {
      const known = knownRequirements(memory, projectKey(cwd));
      if (known.length === 0) return;
      const report = shadowReport({ repoPath: cwd, known });
      inbox.add({ kind: 'shadow', text: report.line, refs: [projectKey(cwd)] });
    },
    ...(opts.cwd === undefined ? {} : { cwdDefault: opts.cwd }),
  });

  const previousBrainEvent = log
    .read()
    .filter((e) => e.kind === 'session_start' && e.payload['role'] === 'brain')
    .pop();
  const brain = sessions.create({
    role: 'brain',
    ...(previousBrainEvent ? { id: previousBrainEvent.sessionId } : {}),
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
  });
  sessions.rehydrate(brain.id);
  voiceCache = await detectVoice(dataDir, currentSettings().voiceLang);

  const dmn = new Dmn({
    sessions,
    inbox,
    idle,
    memory,
    log,
    distiller: dmnDistiller,
    onError: (message) => hub.send({ type: 'error', sessionId: brain.id, message }),
    settings: () => {
      const autonomy = settingsStore.get().autonomy;
      // So tests can set the threshold to 0; in production the setting applies as-is.
      return opts.autonomyIdleMinutes === undefined ? autonomy : { ...autonomy, idleMinutes: opts.autonomyIdleMinutes };
    },
    cwd: opts.cwd ?? process.cwd(),
    buildDriveInput: () => {
      const since = Date.now() - 7 * 86_400_000;
      const events = log.read();
      // The autonomous session's drive prompt is also written as `message/user`: it must not feed itself.
      const autonomous = new Set(
        events
          .filter((e) => e.kind === 'session_start' && e.payload['autonomous'] === true)
          .map((e) => e.sessionId),
      );
      const userMessages = events
        .filter(
          (e) =>
            e.kind === 'message' &&
            e.payload['role'] === 'user' &&
            e.ts >= since &&
            !autonomous.has(e.sessionId),
        )
        .map((e) => e.body ?? '');
      const knownText = memory
        .list({ includeDormant: true })
        .flatMap((n) => [n.text, ...n.concepts])
        .join(' ');
      // styleSignals is empty in phase 2; it will be fed by the repetition counter in phase 4.
      return { logOk: log.verify().ok, unknownTerms: unknownTermsFrom({ userMessages, knownText }), styleSignals: [] };
    },
  });

  const server = createKarenServer({
    repos,
    sessions,
    approvals,
    hub,
    token,
    skills,
    memory,
    world,
    state,
    growth: {
      list: () => growth.list(),
      apply: (id) => growth.apply(id),
      revert: (id) => growth.revert(id),
      reject: (id) => growth.reject(id),
      codeEditsEnabled,
    },
    settings: {
      get: () => settingsStore.public(),
      patch: (patch) => {
        const next = settingsStore.set(patch as Partial<Settings>);
        applySettings(next);
        sessions.setMaxBackground(next.maxBackground);
        return settingsStore.public();
      },
      secrets: (patch) => {
        settingsStore.setSecrets(patch);
        applySettings(settingsStore.get());
        return settingsStore.public();
      },
      providerInfo: () => {
        // If the provider fell back to local for want of a key, the UI should say so plainly.
        const want = settingsStore.get().provider;
        const active = provider.name;
        const fellBack = (want === 'anthropic' || want === 'openai' || want === 'custom') && active === 'ollama';
        return { label: built.label, active, model: provider.activeModel, fellBack, requested: want };
      },
    },
    dashboard: () =>
      buildDashboard({
        sessions: sessions.list(),
        memory,
        approvals,
        logEvents: log.read(),
        voice: voiceCache ?? { status: 'unavailable', lang: 'tr-TR' },
        provider: { active: provider.name, model: provider.activeModel },
        pendingProposals: growth.pending().length,
        unreadInbox: inbox.unreadCount(),
        state: { ...state.current(), temperature: state.temperature() },
        intuitions: buildIntuitions(memory).length,
      }),
    voice: {
      status: async () => {
        voiceCache = await detectVoice(dataDir, currentSettings().voiceLang);
        return voiceCache;
      },
      transcribe: (audio) =>
        isWav(audio)
          ? whisper.transcribe(audio, currentSettings().voiceLang.slice(0, 2))
          : Promise.resolve({ ok: false, reason: 'WAV bekleniyor' }),
      speak: async (text) => {
        const info = voiceCache ?? (await detectVoice(dataDir, currentSettings().voiceLang));
        const settings = currentSettings();
        const looksTurkish =
          /[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|için|değil|tamam|merhaba|evet|hayır|lütfen|teşekkür|nasılsın)\b/i.test(text);
        if (looksTurkish && !info.speech.turkish) {
          return { ok: false, reason: 'Türkçe ses yüklü değil (Windows → Konuşma → Ses ekle)' };
        }
        const voice =
          settings.voiceName ??
          info.speech.voices.find((v) => v.culture.toLowerCase().startsWith(settings.voiceLang.slice(0, 2)))?.name;
        return speak(text, voice === undefined ? {} : { voice });
      },
    },
    inbox: {
      list: (o) => inbox.list(o),
      markRead: (id) => inbox.markRead(id),
      unreadCount: () => inbox.unreadCount(),
    },
    onActivity: () => {
      idle.touch();
      const unread = inbox.unreadCount();
      // With no notes wasIdle is not consumed: the greeting stays available for the next return.
      if (unread === 0) return;
      const { idleMinutes } = currentSettings().autonomy;
      if (!shouldGreet(idle.wasIdle(idleMinutes), unread)) return;
      const suggestions = inbox
        .list({ unreadOnly: true, limit: 500 })
        .filter((item) => item.kind === 'suggestion' || item.kind === 'research').length;
      // Localised to the interface language; the model reports it in the user's language.
      const line = greetingLine(
        unread,
        suggestions,
        message(currentSettings().locale === 'tr' ? 'tr' : 'en', 'inbox.greeting', { notes: unread, suggestions }),
      );
      if (line !== null) sessions.notify(brain.id, line);
    },
    // Fallback only: the UI sends its active language on every request.
    settingsLocale: () => {
      const setting = currentSettings().locale;
      return setting === 'tr' ? 'tr' : 'en';
    },
    runSleep,
    probeProvider: async () => {
      const started = Date.now();
      try {
        let text = '';
        for await (const delta of provider.stream({
          model: 'default',
          messages: [{ role: 'user', content: 'ping' }],
          tools: [],
          signal: AbortSignal.timeout(20_000),
        })) {
          if (delta.type === 'text') text += delta.text;
          if (text.length > 20) break;
        }
        return { ok: true, label: provider.name, ms: Date.now() - started };
      } catch (err) {
        return { ok: false, reason: (err as Error).message.slice(0, 200) };
      }
    },
    rootDir: opts.rootDir ?? process.cwd(),
  });
  const { port } = await server.listen(opts.port ?? 0);
  const url = `http://127.0.0.1:${port}/?token=${token}`;
  dmn.start();

  // Amygdala: if the process is about to die, stop the oldest running worker without waiting
  // for the model. The brain is never the victim; it writes the report afterwards.
  const reflexState = reflexMonitorState();
  const reflexTimer = setInterval(() => {
    // The monitor guards the process: an error thrown here must not take the process down.
    // No error event is logged either; if the log throws, it would throw a second time.
    try {
      reflexTick(
        reflexState,
        {
          list: () => sessions.list(),
          abort: (id) => sessions.abort(id),
          notify: (id, text) => sessions.notify(id, text),
          brain: () => sessions.brain(),
          log,
        },
        { rssMb: process.memoryUsage().rss / MB, totalMb: totalmem() / MB },
        Date.now(),
      );
    } catch {
      // swallowed
    }
  }, REFLEX_MONITOR_MS);
  // The monitor does not keep the process alive.
  reflexTimer.unref();

  return {
    ...server,
    token,
    url,
    memory,
    state,
    settings: settingsStore,
    sleep: runSleep,
    autonomy: {
      touch: () => idle.touch(),
      stop: () => dmn.stop(),
      tick: (now = Date.now()) => dmn.tick(now),
      stats: () => dmn.stats(),
    },
    async close() {
      // The timer must not outlive shutdown.
      clearInterval(reflexTimer);
      dmn.stop();
      whisper.stop();
      await server.close();
      log.close();
    },
  };
}
