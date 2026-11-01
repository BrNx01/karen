import type { DashboardData } from '../../../server/dashboard.js';
import { Icon, type IconName } from '../icons.js';
import type { SessionInfo } from '../../../server/sessions.js';
import type { Key, Locale } from '../../../shared/i18n/index.js';
import { useI18n } from '../i18n.js';
import { localeTag } from '../locale.js';

import { StateStrip } from './StateStrip.js';

export type StageScreen = 'overview' | 'chat' | 'inbox' | 'memory' | 'map' | 'skills' | 'repos' | 'growth' | 'settings';

type Translate = (key: Key, vars?: Record<string, string | number>) => string;

const NAV: { id: StageScreen; label: Key; icon: IconName; badge?: (data: DashboardData | null) => number | null }[] = [
  { id: 'overview', label: 'nav.overview', icon: 'nav.overview' },
  { id: 'chat', label: 'nav.chat', icon: 'nav.chat' },
  { id: 'inbox', label: 'nav.inbox', icon: 'nav.inbox', badge: (d) => d?.unreadInbox ?? null },
  { id: 'memory', label: 'nav.memory', icon: 'nav.memory', badge: (d) => d?.memory.notes ?? null },
  { id: 'map', label: 'nav.map', icon: 'nav.map' },
  { id: 'skills', label: 'nav.skills', icon: 'nav.skills' },
  { id: 'growth', label: 'nav.growth', icon: 'nav.growth', badge: (d) => d?.pendingProposals ?? null },
  { id: 'repos', label: 'nav.repos', icon: 'nav.repos' },
  { id: 'settings', label: 'nav.settings', icon: 'nav.settings' },
];

const STATUS_TEXT: Record<DashboardData['status'], Key> = {
  optimal: 'dashboard.status.optimal',
  busy: 'dashboard.status.busy',
  attention: 'dashboard.status.attention',
};

const VOICE_TEXT: Record<DashboardData['voice']['status'], Key> = {
  ready: 'settings.voiceStatus.ready',
  'no-model': 'settings.voiceStatus.noModel',
  unavailable: 'settings.voiceStatus.unavailable',
};

function ago(ts: number, t: Translate): string {
  const minutes = Math.floor(Math.max(0, Date.now() - ts) / 60_000);
  if (minutes < 1) return t('dashboard.ago.now');
  if (minutes < 60) return t('dashboard.ago.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('dashboard.ago.hours', { count: hours });
  return t('dashboard.ago.days', { count: Math.floor(hours / 24) });
}

function clock(ts: number, locale: Locale): string {
  return new Date(ts).toLocaleTimeString(localeTag(locale), { hour: '2-digit', minute: '2-digit' });
}

function uptime(seconds: number, t: Translate): string {
  if (seconds < 60) return t('dashboard.duration.seconds', { count: seconds });
  if (seconds < 3600) return t('dashboard.duration.minutes', { count: Math.floor(seconds / 60) });
  const hours = Math.floor(seconds / 3600);
  return t('dashboard.duration.hoursMinutes', { hours, minutes: Math.floor((seconds % 3600) / 60) });
}

export function Sidebar(props: {
  screen: StageScreen;
  data: DashboardData | null;
  onNavigate: (screen: StageScreen) => void;
  onTalk: () => void;
  listening: boolean;
}) {
  const { t } = useI18n();
  return (
    <aside className="cc-side">
      <div className="cc-logo">
        <span className="cc-logo-mark">K</span>
        <div>
          <b>KAREN</b>
          <small>{t('dashboard.title')}</small>
        </div>
      </div>

      <nav className="cc-nav">
        {NAV.map((item) => {
          const badge = item.badge?.(props.data);
          return (
            <button
              key={item.id}
              className={props.screen === item.id ? 'active' : ''}
              onClick={() => props.onNavigate(item.id)}
            >
              <span className="cc-nav-icon"><Icon name={item.icon} size={18} /></span>
              <span className="cc-nav-label">{t(item.label)}</span>
              {badge !== null && badge !== undefined && badge > 0 && <span className="cc-nav-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="cc-voice-card">
        <header>
          <span>{t('dashboard.voiceStatus')}</span>
          <b className={props.data?.voice.status === 'ready' ? 'ok' : 'muted'}>
            {props.data ? t(VOICE_TEXT[props.data.voice.status]) : '—'}
          </b>
        </header>
        <div className={`cc-wave ${props.listening ? 'live' : ''}`}>
          {Array.from({ length: 22 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${(i % 7) * 90}ms` }} />
          ))}
        </div>
        <button className={`cc-talk-mini ${props.listening ? 'live' : ''}`} onClick={props.onTalk}>
          {props.listening ? t('dashboard.listening') : t('dashboard.talk')}
        </button>
      </div>
    </aside>
  );
}

export function CommandCenter(props: {
  data: DashboardData | null;
  onNavigate: (screen: StageScreen) => void;
  onSelectSession: (id: string) => void;
  onSleep: () => void;
  busy: boolean;
}) {
  const { t, locale } = useI18n();
  const data = props.data;
  const agents = (data?.sessions ?? []).slice(0, 4);
  const events = (data?.events ?? []).slice(0, 6);
  const actions = (data?.recentActions ?? []).slice(0, 5);

  return (
    <div className="cc-grid">
      {/* column 1 top: core summary */}
      <section className="cc-panel cc-overview">
        <h3>{t('dashboard.core')}</h3>
        <ul className="cc-list">
          <li>
            <span className="cc-ico">◉</span>
            <div>
              <b>{data?.status === 'optimal' ? t('dashboard.status.active') : data ? t(STATUS_TEXT[data.status]) : '—'}</b>
              <small>{t('dashboard.statusLabel')}</small>
            </div>
          </li>
          <li onClick={() => props.onNavigate('memory')}>
            <span className="cc-ico">◈</span>
            <div>
              <b>{t('common.notes', { count: data?.memory.notes ?? 0 })}</b>
              <small>{t('nav.memory')}</small>
            </div>
          </li>
          <li>
            <span className="cc-ico"><Icon name="action.mic" size={18} /></span>
            <div>
              <b>{data ? t(VOICE_TEXT[data.voice.status]) : '—'}</b>
              <small>{t('dashboard.voice')}</small>
            </div>
          </li>
          <li onClick={() => props.onNavigate('chat')}>
            <span className="cc-ico"><Icon name="nav.chat" size={18} /></span>
            <div>
              <b>{t('dashboard.agentRunningWithCount', { count: data?.activeAgents ?? 0 })}</b>
              <small>{t('dashboard.agents')}</small>
            </div>
          </li>
          <li>
            <span className="cc-ico"><Icon name="nav.skills" size={18} /></span>
            <div>
              <b>{data?.provider.active ?? '—'}</b>
              <small>{data?.provider.model ?? t('settings.model')}</small>
            </div>
          </li>
          <li>
            <span className="cc-ico"><Icon name="nav.settings" size={18} /></span>
            <div>
              <b>{data ? uptime(data.system.uptimeSec, t) : '—'}</b>
              <small>{t('dashboard.uptimeLabel')}</small>
            </div>
          </li>
        </ul>
      </section>

      {/* top middle: sphere */}
      <section className="cc-core">
        <div className={`cc-sphere ${data?.status ?? 'optimal'}`}>
          <span className="cc-ring r1" />
          <span className="cc-ring r2" />
          <span className="cc-ring r3" />
          <span className="cc-globe" />
          <img className="cc-core-mark" src="/karen-mark-round.svg" alt="" width={188} height={188} />
          <small>{t('dashboard.tagline')}</small>
        </div>
        <div className="cc-core-stats">
          <div>
            <b>{data?.turns ?? 0}</b>
            <span>{t('dashboard.stat.turns')}</span>
          </div>
          <div>
            <b>{data?.toolCalls ?? 0}</b>
            <span>{t('dashboard.stat.tools')}</span>
          </div>
          <div>
            <b>{data?.memory.conflicts ?? 0}</b>
            <span>{t('memory.conflictBadge')}</span>
          </div>
          <div>
            <b>{data?.pendingApprovals ?? 0}</b>
            <span>{t('dashboard.stat.approvals')}</span>
          </div>
        </div>
      </section>

      {/* top right: live feed */}
      <section className="cc-panel cc-feed-panel">
        <h3>
          {t('dashboard.feed')} <span className="cc-live" />
          {data !== null && data.unreadInbox !== undefined && data.unreadInbox > 0 && (
            <button className="cc-link" onClick={() => props.onNavigate('inbox')}>
              {t('inbox.unread', { count: data.unreadInbox })}
            </button>
          )}
        </h3>
        <ul className="cc-feed">
          {events.map((event, index) => (
            <li key={`${event.at}-${index}`} className={event.tone}>
              <span className="cc-feed-dot" />
              <span className="cc-feed-text">{event.text}</span>
              <span className="cc-feed-time">{ago(event.at, t)}</span>
            </li>
          ))}
          {events.length === 0 && <li className="muted">{t('dashboard.noEventsHint')}</li>}
        </ul>
      </section>

      {/* bottom left: agents */}
      <section className="cc-panel cc-agents">
        <h3>
          {t('dashboard.activeAgents')}
          <button className="cc-link" onClick={() => props.onNavigate('chat')}>
            {t('dashboard.all')}
          </button>
        </h3>
        <div className="cc-agent-grid">
          {agents.map((session: SessionInfo) => (
            <button key={session.id} className="cc-agent" onClick={() => props.onSelectSession(session.id)}>
              <span className={`cc-agent-dot ${session.status}`} />
              <div>
                <b>
                  {session.role === 'brain' ? '◆ ' : ''}
                  {session.title}
                </b>
                <small>{session.cwd}</small>
              </div>
              <span className={`cc-agent-state ${session.status}`}>{session.status}</span>
            </button>
          ))}
          {agents.length === 0 && <p className="muted">{t('dashboard.noAgents')}</p>}
        </div>
      </section>

      {/* bottom middle: timeline */}
      <section className="cc-panel cc-timeline-panel">
        <h3>{t('dashboard.timeline')}</h3>
        <ol className="cc-timeline">
          {actions.map((action) => (
            <li key={action.id} className={action.ok ? 'ok' : 'bad'}>
              <span className="cc-t-time">{clock(action.at, locale)}</span>
              <span className="cc-t-body">
                <b>{action.tool}</b>
                <small>{action.detail || (action.ok ? t('dashboard.actionOk') : t('dashboard.actionFailed'))}</small>
              </span>
            </li>
          ))}
          {actions.length === 0 && <li className="muted">{t('dashboard.noToolRuns')}</li>}
        </ol>
      </section>

      {/* bottom right: memory insight */}
      <section className="cc-panel cc-insight">
        <h3>
          {t('dashboard.insight')}
          <button className="cc-link" onClick={() => props.onNavigate('memory')}>
            {t('common.open')}
          </button>
        </h3>
        <div className="cc-insight-body">
          <div className="cc-bars">
            <Bar label={t('memory.kind.semantic')} value={data?.memory.semantic ?? 0} total={data?.memory.notes ?? 1} color="var(--data)" />
            <Bar label={t('memory.kind.episodic')} value={data?.memory.episodic ?? 0} total={data?.memory.notes ?? 1} color="var(--accent)" />
            <Bar label={t('dashboard.bar.dormant')} value={data?.memory.dormant ?? 0} total={data?.memory.notes ?? 1} color="var(--faint)" />
          </div>
          <ul className="cc-mini">
            <li>
              <span>{t('dashboard.fact.notes')}</span>
              <b>{data?.memory.notes ?? 0}</b>
            </li>
            <li>
              <span>{t('dashboard.fact.projects')}</span>
              <b>{data?.memory.projects ?? 0}</b>
            </li>
            <li>
              <span>{t('memory.conflictBadge')}</span>
              <b className={data && data.memory.conflicts > 0 ? 'warn' : ''}>{data?.memory.conflicts ?? 0}</b>
            </li>
            <li>
              <span>{t('memory.traumaBadge')}</span>
              <b className={data && data.memory.trauma > 0 ? 'warn' : ''}>{data?.memory.trauma ?? 0}</b>
            </li>
            <li>
              <span>{t('dashboard.fact.intuitions')}</span>
              <b>{data?.intuitions ?? 0}</b>
            </li>
            <li>
              <span>{t('dashboard.stat.turns')}</span>
              <b>{data?.turns ?? 0}</b>
            </li>
          </ul>
        </div>
      </section>

      {/* bottom: system strip (model info lives here too) */}
      <section className="cc-panel cc-monitor">
        <h3>
          {t('dashboard.system')}
          <button className="cc-link" onClick={() => props.onNavigate('settings')}>
            {data?.provider.model ?? t('settings.model')} · {t('nav.settings')}
          </button>
        </h3>
        <StateStrip />
        <div className="cc-gauges">
          <Gauge label="CPU" value={data?.system.cpuPercent ?? 0} max={100} unit="%" />
          <Gauge label="RAM" value={data?.system.rssMb ?? 0} max={1024} unit="MB" />
          <Gauge label={t('dashboard.gauge.heap')} value={data?.system.heapMb ?? 0} max={512} unit="MB" />
          <div className="cc-monitor-facts">
            <span>{data?.provider.active ?? '—'}</span>
            <span>{t('dashboard.uptime', { duration: data ? uptime(data.system.uptimeSec, t) : '—' })}</span>
            <span>{t('dashboard.toolCalls', { count: data?.toolCalls ?? 0 })}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function Gauge(props: { label: string; value: number; max: number; unit: string }) {
  const ratio = Math.min(1, props.max === 0 ? 0 : props.value / props.max);
  const degrees = Math.round(ratio * 360);
  return (
    <div className="cc-gauge">
      <div
        className="cc-gauge-ring"
        style={{
          background: `conic-gradient(var(--accent) ${degrees}deg, rgba(255,255,255,0.06) ${degrees}deg)`,
        }}
      >
        <span>{props.value}</span>
      </div>
      <small>
        {props.label} <em>{props.unit}</em>
      </small>
    </div>
  );
}

function Bar(props: { label: string; value: number; total: number; color: string }) {
  const pct = props.total === 0 ? 0 : Math.round((props.value / props.total) * 100);
  return (
    <div className="cc-bar-row">
      <span>{props.label}</span>
      <div className="cc-bar">
        <i style={{ width: `${pct}%`, background: props.color }} />
      </div>
      <b>{props.value}</b>
    </div>
  );
}
