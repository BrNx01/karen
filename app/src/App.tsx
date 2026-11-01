import { useEffect, useReducer, useRef, useState } from 'react';
import { ApprovalCard, Chat } from './components/Chat.js';
import { RepoGrid } from './components/RepoGrid.js';
import { deleteJson, getJson, buildUrl, openSocket, patchJson, postJson, setRequestLocale, token, type ServerMsg } from './api.js';
import { initialState, reduce } from './state.js';
import { encodeWav, resample, toMono } from './audio.js';
import { SkillGrid } from './components/SkillGrid.js';
import { GrowthScreen } from './components/Growth.js';
import { InboxScreen } from './components/Inbox.js';
import { SettingsScreen } from './components/Settings.js';
import { MemoryGrid } from './components/MemoryGrid.js';
import { BrainMapView } from './components/BrainMap.js';
import type { StageScreen } from './screens.js';
import { Cockpit } from './components/Cockpit.js';
import { AppShell } from './components/AppShell.js';
import { I18nProvider, useI18n } from './i18n.js';
import { Icon } from './icons.js';
import { localeTag, osLocaleTag } from './locale.js';
import { resolveLocale, type Locale, type LocaleSetting } from '../../shared/i18n/index.js';
import { startWakeWord, wakeWordSupported, isFatalWakeError, wakeErrorText } from './wake.js';
import { speakInBrowser, speakWithVoice, stopSpeaking } from './speech.js';
import type { SessionInfo } from '../../server/sessions.js';
import type { Repo } from '../../server/repos.js';
import type { InstalledSkill } from '../../server/skills.js';
import type { Note } from '../../server/memory/notes.js';
import type { BrainMap } from '../../server/memory/map.js';
import type { DashboardData } from '../../server/dashboard.js';
import type { VoiceInfo } from '../../server/voice/index.js';
import './styles.css';
import './polish.css';
import './command.css';
import './shell.css';
import './settings.css';
import './cockpit.css';
import './chat.css';

type NoteView = Note & { strength?: number };
type SettingsValue = {
  wakeWord: boolean;
  voiceLang: 'tr-TR' | 'en-US';
  voiceName: string | null;
  speakReplies: boolean;
  locale: LocaleSetting;
};

const withToken = (path: string): string => buildUrl(path);

const STAGE_KEYS: Record<StageScreen, string> = {
  overview: 'nav.overview',
  chat: 'nav.chat',
  inbox: 'nav.inbox',
  memory: 'nav.memory',
  map: 'nav.map',
  skills: 'nav.skills',
  growth: 'nav.growth',
  repos: 'nav.repos',
  settings: 'nav.settings',
};

export function App() {
  const [locale, setLocale] = useState<Locale>('en');
  // The active language follows the saved setting; 'auto' reads the OS tag once.
  useEffect(() => {
    void (async () => {
      try {
        const data = await getJson<{ locale?: LocaleSetting }>('/api/settings');
        const resolved = resolveLocale(data.locale ?? 'auto', osLocaleTag(navigator));
        setLocale(resolved);
        setRequestLocale(resolved);
      } catch {
        // Server down: keep the English default rather than guessing.
      }
    })();
  }, []);

  // CSS uppercasing is language-sensitive ("i" → "İ" in Turkish); keep <html lang> in sync.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nProvider locale={locale}>
      <AppBody locale={locale} onLocaleChange={setLocale} />
    </I18nProvider>
  );
}

function AppBody(props: { locale: Locale; onLocaleChange: (locale: Locale) => void }) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(reduce, initialState);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [conflicts, setConflicts] = useState<{ a: NoteView; b: NoteView }[]>([]);
  const [brainMap, setBrainMap] = useState<BrainMap | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [voice, setVoice] = useState<VoiceInfo | null>(null);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [settings, setSettings] = useState<SettingsValue | null>(null);
  const [wakeActive, setWakeActive] = useState(false);
  const [noteQuery, setNoteQuery] = useState('');
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [showDormant, setShowDormant] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const [screen, setScreen] = useState<StageScreen>('overview');
  const [input, setInput] = useState('');
  const [clockNow, setClockNow] = useState(new Date());

  const socket = useRef<WebSocket | null>(null);
  const activeId = useRef<string | null>(null);
  const settingsRef = useRef<{ voiceName: string | null; voiceLang: 'tr-TR' | 'en-US' }>({
    voiceName: null,
    voiceLang: 'tr-TR',
  });
  const lastAssistant = useRef('');
  const speakRepliesRef = useRef(true);
  const screenRef = useRef<StageScreen>('overview');

  useEffect(() => {
    activeId.current = state.activeId;
  }, [state.activeId]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    speakRepliesRef.current = speakReplies;
  }, [speakReplies]);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [sessions, repoList, skillList, settingsData] = await Promise.all([
          getJson<SessionInfo[]>('/api/sessions'),
          getJson<Repo[]>('/api/repos'),
          getJson<InstalledSkill[]>('/api/skills').catch(() => [] as InstalledSkill[]),
          getJson<SettingsValue>('/api/settings').catch(() => null),
        ]);
        const created = sessions.length > 0 ? sessions : [await postJson<SessionInfo>('/api/sessions', {})];
        setRepos(repoList);
        setSkills(skillList);
        if (settingsData) {
          setSettings(settingsData);
          settingsRef.current = { voiceName: settingsData.voiceName, voiceLang: settingsData.voiceLang };
          setSpeakReplies(settingsData.speakReplies);
        }
        dispatch({ type: 'sessions', sessions: created });
        dispatch({ type: 'select', sessionId: created[0]?.id ?? '' });
        activeId.current = created[0]?.id ?? null;
      } catch (err) {
        dispatch({ type: 'error', message: (err as Error).message });
      }
    })();
    void loadDashboard();
    void loadVoice();
    const timer = setInterval(() => {
      if (!document.hidden) void loadDashboard();
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ws = openSocket(handleMessage);
    socket.current = ws;
    ws.addEventListener('open', () => {
      dispatch({ type: 'connected', connected: true });
      void rehydrateApprovals();
    });
    ws.addEventListener('close', () => dispatch({ type: 'connected', connected: false }));
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The wake phrase: when enabled in settings it listens continuously; on hearing it, opens chat and starts recording.
  useEffect(() => {
    if (!settings?.wakeWord) {
      setWakeActive(false);
      return;
    }
    if (!wakeWordSupported()) {
      dispatch({ type: 'error', message: t('wake.unsupported') });
      return;
    }
    setWakeActive(true);
    const handle = startWakeWord({
      lang: settings.voiceLang,
      onWake: () => {
        stopSpeaking();
        setScreen('chat');
        void talk();
      },
      onError: (message) => {
        // Permanent error: turn listening off and show a single clear warning.
        if (isFatalWakeError(message)) {
          setWakeActive(false);
          dispatch({ type: 'error', message: wakeErrorText(message, t) });
          void patchJson('/api/settings', { wakeWord: false }).catch(() => undefined);
        } else {
          dispatch({ type: 'error', message: wakeErrorText(message, t) });
        }
      },
    });
    return () => {
      handle.stop();
      setWakeActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.wakeWord, settings?.voiceLang]);

  // The error/notice strip closes on its own.
  useEffect(() => {
    if (!state.error && !state.notice) return;
    const timer = setTimeout(() => {
      dispatch({ type: 'error', message: null });
      dispatch({ type: 'notice', text: '' });
    }, 7000);
    return () => clearTimeout(timer);
  }, [state.error, state.notice]);

  useEffect(() => {
    const last = [...state.messages].reverse().find((m) => m.role === 'assistant');
    lastAssistant.current = last?.text ?? '';
  }, [state.messages]);

  function handleMessage(msg: ServerMsg) {
    const mine = (sessionId?: string) => !sessionId || sessionId === activeId.current;
    switch (msg.type) {
      case 'delta':
        if (mine(msg.sessionId)) dispatch({ type: 'delta', delta: msg.delta as never });
        break;
      case 'done':
        if (mine(msg.sessionId)) {
          dispatch({ type: 'done' });
          if (speakRepliesRef.current && lastAssistant.current.trim() !== '') void speakText(lastAssistant.current);
        }
        void loadDashboard();
        break;
      case 'history':
        if (mine(msg.sessionId)) {
          dispatch({
            type: 'history',
            messages: msg.messages.map((m, index) => ({
              id: `h${index}`,
              role: m.role === 'user' ? 'user' : 'assistant',
              text: m.content,
            })),
          });
        }
        break;
      case 'approval_request':
        dispatch({
          type: 'approval',
          approval: {
            sessionId: msg.sessionId,
            requestId: msg.requestId,
            tool: msg.tool,
            args: msg.args,
            reason: msg.reason,
          },
        });
        break;
      case 'error':
        dispatch({ type: 'error', message: msg.message });
        break;
      case 'notice':
        dispatch({ type: 'notice', text: msg.text });
        void refreshSessions();
        void loadDashboard();
        break;
      case 'status':
        refreshSessions();
        break;
      default:
        break;
    }
  }

  async function refreshSessions() {
    try {
      dispatch({ type: 'sessions', sessions: await getJson<SessionInfo[]>('/api/sessions') });
    } catch {
      /* connection trouble is shown separately */
    }
  }

  async function createSession(cwd?: string) {
    const session = await postJson<SessionInfo>('/api/sessions', cwd ? { cwd } : {});
    dispatch({ type: 'sessions', sessions: [...state.sessions, session] });
    dispatch({ type: 'select', sessionId: session.id });
    setScreen('chat');
  }

  async function loadNotes(query: string, dormant: boolean) {
    try {
      const params = new URLSearchParams();
      if (query.trim() !== '') params.set('q', query.trim());
      if (dormant) params.set('dormant', '1');
      const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
      const [list, pairs] = await Promise.all([
        getJson<NoteView[]>(`/api/memory${suffix}`),
        getJson<{ a: NoteView; b: NoteView }[]>('/api/memory/conflicts').catch(() => []),
      ]);
      setNotes(list);
      setConflicts(pairs);
    } catch (err) {
      dispatch({ type: 'error', message: t('app.memoryLoadFailed', { detail: (err as Error).message }) });
    }
  }

  async function runSleep() {
    setSleeping(true);
    try {
      const report = await postJson<{ ran: boolean; notesAdded: number; skipped?: string }>('/api/memory/sleep', {});
      dispatch({
        type: 'error',
        message: report.ran
          ? `uyku bitti: ${report.notesAdded} yeni not`
          : t('memory.sleepFailed', { detail: report.skipped ?? t('common.unknown') }),
      });
      await loadNotes(noteQuery, showDormant);
      await loadDashboard();
    } catch (err) {
      dispatch({ type: 'error', message: t('memory.sleepError', { detail: (err as Error).message }) });
    } finally {
      setSleeping(false);
    }
  }

  async function loadMap() {
    try {
      setBrainMap(await getJson<BrainMap>('/api/map'));
    } catch (err) {
      dispatch({ type: 'error', message: t('map.loadFailed', { detail: (err as Error).message }) });
    }
  }

  async function loadDashboard() {
    try {
      setDashboard(await getJson<DashboardData>('/api/dashboard'));
    } catch (err) {
      // dashboard must not silently stay empty: the error goes to the console and the strip.
      console.error('dashboard:', err);
      dispatch({ type: 'error', message: `pano: ${(err as Error).message}` });
    }
  }

  async function loadVoice() {
    try {
      setVoice(await getJson<VoiceInfo>('/api/voice/status'));
    } catch {
      setVoice(null);
    }
  }

  function memoryAction(id: string, action: 'forget' | 'restore' | 'correct' | 'trauma', text?: string): Promise<void> {
    return fetch(withToken(`/api/memory/${id}/${action}`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(text === undefined ? {} : { text }),
    }).then((res) => {
      // Trauma cannot be undone: do not silently swallow a failed response.
      if (action === 'trauma' && !res.ok) throw new Error(t('memory.traumaFailed', { detail: res.status }));
      void loadNotes(noteQuery, showDormant);
      void loadDashboard();
    });
  }

  function resolveConflict(aId: string, bId: string, winner: 'a' | 'b') {
    const loser = winner === 'a' ? bId : aId;
    void fetch(withToken(`/api/memory/${loser}/forget`), { method: 'POST' }).then(() => {
      void loadNotes(noteQuery, showDormant);
      void loadDashboard();
    });
  }

  async function addSkill(source: { path?: string; git?: string }) {
    try {
      const installed = await postJson<InstalledSkill[]>('/api/skills', source);
      setSkills((current) => {
        const map = new Map(current.map((item) => [item.id, item]));
        for (const skill of installed) map.set(skill.id, skill);
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
      dispatch({ type: 'error', message: null });
    } catch (err) {
      dispatch({ type: 'error', message: `yetenek eklenemedi: ${(err as Error).message}` });
    }
  }

  async function rehydrateApprovals() {
    try {
      const pending = await getJson<
        { sessionId: string; requestId: string; tool: string; args: Record<string, unknown>; reason: string }[]
      >('/api/approvals');
      dispatch({
        type: 'approvals',
        approvals: pending.map((item) => ({
          sessionId: item.sessionId,
          requestId: item.requestId,
          tool: item.tool,
          args: item.args,
          reason: item.reason,
        })),
      });
    } catch {
      /* connection trouble is shown separately */
    }
  }

  function decide(approval: { sessionId: string; requestId: string }, allow: boolean) {
    if (!socket.current) return;
    socket.current.send(
      JSON.stringify({ type: 'approval', sessionId: approval.sessionId, requestId: approval.requestId, allow }),
    );
    dispatch({ type: 'clearApproval', requestId: approval.requestId });
  }

  function send() {
    const text = input.trim();
    if (!text || !state.activeId || !socket.current) return;
    stopSpeaking();
    socket.current.send(JSON.stringify({ type: 'message', sessionId: state.activeId, text }));
    dispatch({ type: 'user', text });
    setInput('');
  }

  async function speakText(text: string) {
    const { voiceName, voiceLang } = settingsRef.current;
    // KAREN's own voice first (offline Piper); the OS voice is the fallback, not the default.
    const engine = await speakWithVoice(text, { lang: voiceLang, url: withToken('/api/voice/audio') });
    if (engine === 'neural') return;
    if (speakInBrowser(text, { lang: voiceLang, voiceName })) return;
    try {
      const res = await fetch(withToken('/api/voice/speak'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 800) }),
      });
      if (res.ok) return;
    } catch {
      /* no audio: continue in text */
    }
  }

  /** Microphone: record → 16 kHz WAV → local whisper → send. */
  async function talk() {
    if (listening) return;
    if (!voice || voice.status !== 'ready') {
      dispatch({
        type: 'error',
        message:
          voice?.status === 'no-model'
            ? 'ses: whisper modeli yok (npm run karen -- voice-setup)'
            : t('chat.whisperMissing'),
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      dispatch({ type: 'error', message: t('chat.micUnsupported') });
      return;
    }

    stopSpeaking();
    setListening(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
          resolve();
        }, 8000);
        window.addEventListener(
          'karen-stop-listening',
          () => {
            clearTimeout(timeout);
            if (recorder.state !== 'inactive') recorder.stop();
            resolve();
          },
          { once: true },
        );
      });
      await stopped;
      stream.getTracks().forEach((track) => track.stop());

      const blob = new Blob(chunks, { type: chunks[0]?.type ?? 'audio/webm' });
      if (blob.size === 0) {
        dispatch({ type: 'error', message: t('chat.recordingEmpty') });
        return;
      }

      const arrayBuffer = await blob.arrayBuffer();
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(arrayBuffer);
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
      const wav = encodeWav(resample(toMono(channels), decoded.sampleRate, 16000), 16000);
      void context.close();

      const res = await fetch(withToken('/api/voice/transcribe'), {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav,
      });
      const result = (await res.json()) as { ok?: boolean; text?: string; reason?: string };
      if (!res.ok || !result.ok || !result.text) {
        dispatch({ type: 'error', message: t('chat.transcribeFailed', { detail: result.reason ?? String(res.status) }) });
        return;
      }
      socket.current?.send(JSON.stringify({ type: 'message', sessionId: state.activeId, text: result.text }));
      dispatch({ type: 'user', text: result.text });
    } catch (err) {
      dispatch({ type: 'error', message: `mikrofon: ${(err as Error).message}` });
    } finally {
      setListening(false);
    }
  }

  function navigate(next: StageScreen) {
    setScreen(next);
    if (next === 'memory') void loadNotes(noteQuery, showDormant);
    if (next === 'map') void loadMap();
  }

  function selectSession(id: string) {
    setScreen('chat');
    dispatch({ type: 'select', sessionId: id });
    socket.current?.send(JSON.stringify({ type: 'open', sessionId: id }));
  }

  function stopTurn() {
    if (!state.activeId) return;
    setListening(false);
    stopSpeaking();
    socket.current?.send(JSON.stringify({ type: 'abort', sessionId: state.activeId }));
  }

  const status = dashboard?.status ?? 'optimal';

  const context = screen === 'overview' ? undefined : (
    <>
      <h3>{t('chat.approvalTitle')}</h3>
      {state.approvals.length === 0 && <p className="context-empty">{t('common.none')}</p>}
      {state.approvals.map((approval) => (
        <ApprovalCard
          key={approval.requestId}
          approval={approval}
          sessionTitle={state.sessions.find((session) => session.id === approval.sessionId)?.title}
          onDecide={(allow) => decide(approval, allow)}
        />
      ))}

      <h3>{t('dashboard.activeAgents')}</h3>
      <ul className="context-list">
        {state.sessions.slice(0, 5).map((session) => (
          <li key={session.id} onClick={() => selectSession(session.id)}>
            <b>{session.title}</b>
            <small>{session.status}</small>
          </li>
        ))}
        {state.sessions.length === 0 && <li className="muted">{t('dashboard.noAgents')}</li>}
      </ul>

      <h3>{t('dashboard.feed')}</h3>
      <ul className="context-list feed">
        {(dashboard?.events ?? []).slice(0, 6).map((event, index) => (
          <li key={`${event.at}-${index}`} className={event.tone}>
            <b>{event.text}</b>
            <small>{new Date(event.at).toLocaleTimeString(localeTag(props.locale), { hour: '2-digit', minute: '2-digit' })}</small>
          </li>
        ))}
        {(dashboard?.events ?? []).length === 0 && <li className="muted">{t('dashboard.noEventsHint')}</li>}
      </ul>
    </>
  );

  return (
    <AppShell
      screen={screen}
      onNavigate={navigate}
      title={t(STAGE_KEYS[screen] as never)}
      connected={state.connected}
      listening={listening}
      onTalk={() => void talk()}
      badges={{
        inbox: dashboard?.unreadInbox ?? null,
        memory: dashboard?.memory.notes ?? null,
        growth: dashboard?.pendingProposals ?? null,
      }}
      context={context}
      topbarRight={
        <>
          <span className={`cc-chip status ${status}`}>{t(`dashboard.status.${status}` as never)}</span>
          <span className="cc-chip mono">{clockNow.toLocaleTimeString(localeTag(props.locale))}</span>
          {wakeActive && <span className="cc-chip live">hey karen</span>}
          {state.notice && <span className="cc-chip">{state.notice.slice(0, 42)}</span>}
          {state.error && (
            <span className="cc-chip bad" title={state.error}>
              {state.error.slice(0, 42)}
            </span>
          )}
        </>
      }
      composer={
        <form
          className="cc-talk"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <div className={`cc-talk-inner ${listening ? 'live' : ''}`}>
            <button
              type="button"
              className={`cc-talk-mic ${listening ? 'live' : ''}`}
              onClick={() => void talk()}
              title={t('chat.mic')}
            >
              <Icon name="action.mic" size={18} />
            </button>
            <input
              className="cc-talk-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                listening
                  ? t('chat.listeningHint')
                  : t('chat.placeholderIdle', { wake: t('settings.wakeWord') })
              }
              disabled={listening}
            />
            {state.streaming ? (
              <button className="cc-talk-send stop" type="button" onClick={stopTurn} title={t('chat.stop')}>
                <Icon name="action.stop" size={16} />
              </button>
            ) : (
              <button className="cc-talk-send" type="submit" disabled={listening}>
                <Icon name="action.send" size={16} />
              </button>
            )}
          </div>
          <div className="cc-talk-side">
            <span className="cc-chip">{state.sessions.find((s) => s.id === state.activeId)?.title ?? t('chat.sessionTitle')}</span>
            {state.streaming && <span className="cc-chip live">{t('chat.streaming')}</span>}
          </div>
        </form>
      }
    >
      <div className={`cc-body ${screen === 'overview' ? 'overview' : 'detail'}`}>
          {screen === 'overview' && (
            <Cockpit
              data={dashboard}
              messages={state.messages}
              streaming={state.streaming}
              approvals={state.approvals}
              listening={listening}
              sleeping={sleeping}
              onTalk={() => void talk()}
              onSleep={() => void runSleep()}
              onNavigate={navigate}
              onDecide={(approval, allow) => decide(approval, allow)}
            />
          )}

          {screen !== 'overview' && (
            <div className="cc-scroll">
              {screen === 'chat' && <Chat messages={state.messages} streaming={state.streaming} />}
              {screen === 'inbox' && <InboxScreen />}
              {screen === 'memory' && (
                <MemoryGrid
                  notes={notes}
                  query={noteQuery}
                  showDormant={showDormant}
                  busy={sleeping}
                  onSearch={(query) => {
                    setNoteQuery(query);
                    void loadNotes(query, showDormant);
                  }}
                  onToggleDormant={() => {
                    const next = !showDormant;
                    setShowDormant(next);
                    void loadNotes(noteQuery, next);
                  }}
                  onForget={(id) => memoryAction(id, 'forget')}
                  onTrauma={(id) =>
                    memoryAction(id, 'trauma').catch((err: Error) => {
                      dispatch({ type: 'error', message: err.message });
                    })
                  }
                  onRestore={(id) => memoryAction(id, 'restore')}
                  onCorrect={(id, text) => memoryAction(id, 'correct', text)}
                  conflicts={conflicts}
                  onResolveConflict={resolveConflict}
                  onSleep={() => void runSleep()}
                  focusNoteId={focusNoteId}
                />
              )}
              {screen === 'map' && (
                <BrainMapView
                  map={brainMap}
                  onOpenNote={(noteId) => {
                    setScreen('memory');
                    setFocusNoteId(noteId);
                    setNoteQuery('');
                    void loadNotes('', showDormant);
                  }}
                  onForget={(noteId) => {
                    memoryAction(noteId, 'forget');
                    void loadMap();
                  }}
                />
              )}
              {screen === 'skills' && (
                <SkillGrid
                  skills={skills}
                  error={state.error}
                  onAdd={(source) => void addSkill(source)}
                  onToggle={(id, enabled) => {
                    void fetch(withToken(`/api/skills/${id}`), {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ enabled }),
                    }).then(() => setSkills((current) => current.map((s) => (s.id === id ? { ...s, enabled } : s))));
                  }}
                  onRemove={(id) => {
                    void deleteJson(`/api/skills/${id}`).then(() =>
                      setSkills((current) => current.filter((s) => s.id !== id)),
                    );
                  }}
                />
              )}
              {screen === 'repos' && (
                <RepoGrid
                  repos={repos}
                  onOpen={(repo) => void createSession(repo.path)}
                  onAdd={(path) => {
                    void postJson<Repo>('/api/repos', { path }).then((repo) => {
                      setRepos((current) => (current.some((r) => r.id === repo.id) ? current : [...current, repo]));
                    });
                  }}
                  onRemove={(id) => {
                    void deleteJson(`/api/repos/${id}`).then(() =>
                      setRepos((current) => current.filter((r) => r.id !== id)),
                    );
                  }}
                />
              )}
              {screen === 'growth' && (
                <GrowthScreen onMessage={(text) => dispatch({ type: 'notice', text })} />
              )}
              {screen === 'settings' && (
                <SettingsScreen
                  onSaved={(message) => {
                    dispatch({ type: 'error', message: null });
                    void (async () => {
                      const data = await getJson<SettingsValue>('/api/settings').catch(() => null);
                      if (data) {
                        setSettings(data);
                        settingsRef.current = { voiceName: data.voiceName, voiceLang: data.voiceLang };
                        setSpeakReplies(data.speakReplies);
                      }
                      void loadVoice();
                      void loadDashboard();
                    })();
                    if (message !== '') dispatch({ type: 'notice', text: message });
                  }}
                  onVoiceChanged={() => void loadVoice()}
                  locale={props.locale}
                  onLocaleChange={(next) => {
                    props.onLocaleChange(next);
                    setRequestLocale(next);
                  }}
                />
              )}
            </div>
          )}
        </div>

    </AppShell>
  );
}
