import { useEffect, useRef, useState, type JSX } from 'react';
import type { DashboardData } from '../../../server/dashboard.js';
import type { Message, PendingApproval } from '../state.js';
import { ApprovalCard, Chat } from './Chat.js';
import { Icon, type IconName } from '../icons.js';
import { useI18n } from '../i18n.js';
import type { Key } from '../../../shared/i18n/index.js';
import { autoOpen, closePanel, DEFAULT_COCKPIT, togglePanel, toggleZen, type CockpitState, type PanelId } from '../cockpit-state.js';

type Translate = ReturnType<typeof useI18n>['t'];

/** The dock: five small icons, nothing else on screen. */
const DOCK: { id: PanelId; icon: IconName; labelKey: Key }[] = [
  { id: 'conversation', icon: 'nav.chat', labelKey: 'cockpit.conversation' },
  { id: 'memory', icon: 'nav.memory', labelKey: 'cockpit.memory' },
  { id: 'system', icon: 'status.thinking', labelKey: 'cockpit.system' },
  { id: 'inbox', icon: 'nav.inbox', labelKey: 'nav.inbox' },
  { id: 'agents', icon: 'nav.growth', labelKey: 'dashboard.agents' },
];

/**
 * The cockpit: a bare stage with the core, and a quiet dock on the right. An icon
 * grows under the pointer and its panel opens on click. Nothing is permanently
 * on screen, so the room stays empty until it is asked for.
 */
export function Cockpit(props: {
  data: DashboardData | null;
  messages: Message[];
  streaming: boolean;
  approvals: PendingApproval[];
  listening: boolean;
  sleeping: boolean;
  onTalk: () => void;
  onSleep: () => void;
  onNavigate: (screen: 'memory' | 'inbox' | 'map' | 'growth' | 'settings' | 'chat') => void;
  onDecide: (approval: PendingApproval, allow: boolean) => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const [state, setState] = useState<CockpitState>(DEFAULT_COCKPIT);
  const escRef = useRef<HTMLDivElement | null>(null);
  const data = props.data;

  // A reply in flight (or an approval waiting) brings the conversation forward, once.
  const streamingRef = useRef(props.streaming);
  useEffect(() => {
    if (props.streaming && !streamingRef.current) setState((s) => autoOpen(s, 'streaming'));
    streamingRef.current = props.streaming;
  }, [props.streaming]);

  useEffect(() => {
    if (props.approvals.length > 0) setState((s) => autoOpen(s, 'approval'));
  }, [props.approvals.length]);

  // Escape closes the panel before anything else.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && state.panel !== null) setState((s) => closePanel(s));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.panel]);

  useEffect(() => {
    escRef.current?.focus();
  }, [state.panel]);

  const panel = state.panel;

  return (
    <div className={`cockpit ${state.zen ? 'zen' : ''}`}>
      <main className="cockpit-center">
        <div className={`cockpit-core ${data?.status ?? 'optimal'} ${props.listening ? 'listening' : ''}`}>
          <span className="ring r1" />
          <span className="ring r2" />
          <span className="ring r3" />
          <img src="/karen-mark-round.svg" alt="" width={180} height={180} />
        </div>

        <p className="cockpit-statusline">
          <span className="dot" />
          {data ? t(`dashboard.status.${data.status}` as never) : '—'}
          <span className="sep">·</span>
          {data?.provider.model ?? t('settings.model')}
          <span className="sep">·</span>
          {formatUptime(data?.system.uptimeSec ?? 0, t)}
        </p>

        <div className="cockpit-actions">
          <RoundButton icon="action.mic" label={t('dashboard.talk')} onClick={props.onTalk} live={props.listening} />
          <RoundButton icon="status.thinking" label={t('memory.sleep')} onClick={props.onSleep} disabled={props.sleeping} />
        </div>

        <p className="cockpit-hint">
          {new Date().toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </main>

      {!state.zen && (
        <nav className="cockpit-dock" aria-label={t('cockpit.dock')}>
          {DOCK.map((item) => {
            const badge = badgeFor(item.id, data);
            return (
              <button
                key={item.id}
                type="button"
                className={`dock-item ${panel === item.id ? 'active' : ''}`}
                onClick={() => setState((s) => togglePanel(s, item.id))}
                aria-label={t(item.labelKey)}
                aria-pressed={panel === item.id}
                data-panel={item.id}
              >
                <span className="dock-icon">
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="dock-label">{t(item.labelKey)}</span>
                {badge > 0 && <span className="dock-badge">{badge}</span>}
              </button>
            );
          })}

          <span className="dock-sep" />

          <button
            type="button"
            className="dock-item"
            onClick={() => setState((s) => toggleZen(s))}
            aria-label={t('cockpit.zen')}
            data-panel="zen"
          >
            <span className="dock-icon">
              <Icon name="misc.palette" size={18} />
            </span>
            <span className="dock-label">{t('cockpit.zen')}</span>
          </button>

          <button
            type="button"
            className="dock-item"
            onClick={() => props.onNavigate('settings')}
            aria-label={t('nav.settings')}
            data-panel="settings"
          >
            <span className="dock-icon">
              <Icon name="nav.settings" size={18} />
            </span>
            <span className="dock-label">{t('nav.settings')}</span>
          </button>
        </nav>
      )}

      {state.zen && (
        <button type="button" className="zen-exit" onClick={() => setState((s) => toggleZen(s))} title={t('cockpit.exitZen')}>
          <Icon name="misc.palette" size={13} />
          {t('cockpit.exitZen')}
        </button>
      )}

      {panel !== null && (
        <section className={`cockpit-panel panel-${panel}`} ref={escRef} tabIndex={-1} aria-label={t(panelTitleKey(panel))}>
          <header>
            <h2>{t(panelTitleKey(panel))}</h2>
            <button type="button" className="panel-close" onClick={() => setState((s) => closePanel(s))} aria-label={t('common.close')}>
              <Icon name="action.reject" size={14} />
            </button>
          </header>

          {panel === 'conversation' && (
            <div className="cockpit-panel-body">
              <Chat messages={props.messages} streaming={props.streaming} />
              {props.approvals.map((approval) => (
                <ApprovalCard
                  key={approval.requestId}
                  approval={approval}
                  onDecide={(allow) => props.onDecide(approval, allow)}
                />
              ))}
            </div>
          )}

          {panel === 'memory' && <MemoryPanel data={data} t={t} onOpen={() => props.onNavigate('memory')} />}
          {panel === 'system' && <SystemPanel data={data} t={t} />}
          {panel === 'inbox' && <InboxPanel data={data} t={t} onOpen={() => props.onNavigate('inbox')} />}
          {panel === 'agents' && <AgentsPanel data={data} t={t} onOpen={() => props.onNavigate('chat')} />}
        </section>
      )}
    </div>
  );
}

function badgeFor(id: PanelId, data: DashboardData | null): number {
  if (id === 'inbox') return data?.unreadInbox ?? 0;
  if (id === 'agents') return data?.pendingProposals ?? 0;
  if (id === 'conversation') return data?.pendingApprovals ?? 0;
  return 0;
}

function panelTitleKey(panel: PanelId): Key {
  if (panel === 'conversation') return 'cockpit.conversation';
  if (panel === 'memory') return 'cockpit.memory';
  if (panel === 'system') return 'cockpit.system';
  if (panel === 'inbox') return 'nav.inbox';
  return 'dashboard.agents';
}

function MemoryPanel(props: { data: DashboardData | null; t: Translate; onOpen: () => void }): JSX.Element {
  const m = props.data?.memory;
  return (
    <div className="cockpit-panel-body">
      <div className="dock-bars">
        <Bar label={props.t('memory.kind.semantic')} value={ratio(m?.semantic, m?.notes)} color="var(--accent)" />
        <Bar label={props.t('memory.kind.episodic')} value={ratio(m?.episodic, m?.notes)} color="var(--accent-soft)" />
        <Bar label={props.t('dashboard.bar.dormant')} value={ratio(m?.dormant, m?.notes)} color="var(--faint)" />
      </div>
      <ul className="dock-facts">
        <li><b>{m?.notes ?? 0}</b><small>{props.t('dashboard.fact.notes')}</small></li>
        <li><b>{m?.projects ?? 0}</b><small>{props.t('dashboard.fact.projects')}</small></li>
        <li><b>{m?.conflicts ?? 0}</b><small>{props.t('memory.conflictBadge')}</small></li>
        <li><b>{m?.trauma ?? 0}</b><small>{props.t('memory.traumaBadge')}</small></li>
      </ul>
      <button type="button" className="dock-link" onClick={props.onOpen}>
        {props.t('common.open')}
        <Icon name="misc.chevron" size={13} />
      </button>
    </div>
  );
}

function SystemPanel(props: { data: DashboardData | null; t: Translate }): JSX.Element {
  const sys = props.data?.system;
  return (
    <div className="cockpit-panel-body">
      <div className="dock-gauges">
        <Gauge label="CPU" value={sys?.cpuPercent ?? 0} max={100} />
        <Gauge label="RAM" value={sys?.rssMb ?? 0} max={1024} />
        <Gauge label={props.t('dashboard.gauge.heap')} value={sys?.heapMb ?? 0} max={512} />
      </div>
      <ul className="dock-facts four">
        <li><b>{props.data?.turns ?? 0}</b><small>{props.t('dashboard.stat.turns')}</small></li>
        <li><b>{props.data?.toolCalls ?? 0}</b><small>{props.t('dashboard.stat.tools')}</small></li>
        <li><b>{props.data?.memory.conflicts ?? 0}</b><small>{props.t('dashboard.stat.conflicts')}</small></li>
        <li><b>{props.data?.pendingApprovals ?? 0}</b><small>{props.t('dashboard.stat.approvals')}</small></li>
      </ul>
      <div className="dock-feed">
        <h3>{props.t('dashboard.feed')}</h3>
        <ul>
          {(props.data?.events ?? []).slice(0, 6).map((event, index) => (
            <li key={`${event.at}-${index}`} className={event.tone}>
              <span className="d" />
              <b>{event.text}</b>
            </li>
          ))}
          {(props.data?.events ?? []).length === 0 && <li className="none">{props.t('dashboard.noEventsHint')}</li>}
        </ul>
      </div>
    </div>
  );
}

function InboxPanel(props: { data: DashboardData | null; t: Translate; onOpen: () => void }): JSX.Element {
  const unread = props.data?.unreadInbox ?? 0;
  return (
    <div className="cockpit-panel-body">
      <p className="dock-note">{props.t('inbox.unread', { count: unread })}</p>
      <button type="button" className="dock-link" onClick={props.onOpen}>
        {props.t('common.open')}
        <Icon name="misc.chevron" size={13} />
      </button>
    </div>
  );
}

function AgentsPanel(props: { data: DashboardData | null; t: Translate; onOpen: () => void }): JSX.Element {
  const sessions = props.data?.sessions ?? [];
  return (
    <div className="cockpit-panel-body">
      <ul className="dock-agents">
        {sessions.slice(0, 8).map((session) => (
          <li key={session.id}>
            <b>{session.title}</b>
            <small>{session.status}</small>
          </li>
        ))}
        {sessions.length === 0 && <li className="none">{props.t('dashboard.noAgents')}</li>}
      </ul>
      <button type="button" className="dock-link" onClick={props.onOpen}>
        {props.t('common.open')}
        <Icon name="misc.chevron" size={13} />
      </button>
    </div>
  );
}

function Bar(props: { label: string; value: number; color?: string }): JSX.Element {
  const pct = Math.round(Math.min(1, Math.max(0, props.value)) * 100);
  return (
    <div className="dock-bar">
      <span>{props.label}</span>
      <div><i style={{ width: `${pct}%`, background: props.color ?? 'var(--accent)' }} /></div>
      <b>{pct}</b>
    </div>
  );
}

function Gauge(props: { label: string; value: number; max: number }): JSX.Element {
  const r = props.max === 0 ? 0 : Math.min(1, props.value / props.max);
  const deg = Math.round(r * 360);
  return (
    <div className="dock-gauge">
      <div className="dial" style={{ background: `conic-gradient(var(--accent) ${deg}deg, rgba(255,255,255,0.05) ${deg}deg)` }}>
        <span>{Math.round(props.value)}</span>
      </div>
      <small>{props.label}</small>
    </div>
  );
}

function RoundButton(props: {
  icon: IconName;
  label: string;
  onClick: () => void;
  live?: boolean;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`cockpit-action ${props.live ? 'live' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
    >
      <Icon name={props.icon} size={18} />
      <small>{props.label}</small>
    </button>
  );
}

function ratio(part: number | undefined, total: number | undefined): number {
  if (total === undefined || total === 0) return 0;
  return (part ?? 0) / total;
}

function formatUptime(seconds: number, t: Translate): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('dashboard.duration.minutes', { count: minutes });
  return t('dashboard.duration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}
