import { useEffect, useRef, useState, type JSX } from 'react';
import type { DashboardData } from '../../../server/dashboard.js';
import type { Message, PendingApproval } from '../state.js';
import { ApprovalCard, Chat } from './Chat.js';
import { Icon } from '../icons.js';
import { useI18n } from '../i18n.js';
import { cardClass, cardForEvent, isVisible, parsePanels, stringifyPanels, togglePanel, toggleZen, type CockpitCard, type PanelState } from '../cockpit.js';

type Translate = ReturnType<typeof useI18n>['t'];

const STORAGE_KEY = 'karen.cockpit.panels';

/**
 * The cockpit: three live cards on the left, the core in the middle, the conversation
 * on the right. Everything collapses — a panel, both panels (zen), so the screen can
 * breathe while KAREN thinks.
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
  const [panels, setPanels] = useState<PanelState>(() => parsePanels(readStorage()));
  const [focused, setFocused] = useState<CockpitCard | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const data = props.data;

  // Remember the layout between launches: it is a preference, not session state.
  useEffect(() => {
    writeStorage(stringifyPanels(panels));
  }, [panels]);

  // When KAREN does something, the card that explains it steps forward for a moment.
  // The first event after mount is history, not news: only newer ones take focus.
  const lastEvent = data?.events[0]?.text ?? '';
  const seenEvent = useRef<string | null>(null);
  useEffect(() => {
    if (lastEvent === '') return;
    if (seenEvent.current === null) {
      seenEvent.current = lastEvent;
      return;
    }
    if (seenEvent.current === lastEvent) return;
    seenEvent.current = lastEvent;

    const card = cardForEvent(guessKind(lastEvent));
    if (card === null) return;
    setFocused(card);
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => setFocused(null), 4200);
    return () => {
      if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    };
  }, [lastEvent]);

  const state = data?.state;

  return (
    <div className={`cockpit ${panels.zen ? 'zen' : ''}`}>
      <aside className={`cockpit-left ${isVisible(panels, 'left') ? '' : 'hidden'}`} aria-hidden={!isVisible(panels, 'left')}>
        <button
          type="button"
          className="panel-toggle"
          onClick={() => setPanels(togglePanel(panels, 'left'))}
          title={t('cockpit.collapseLeft')}
          aria-label={t('cockpit.collapseLeft')}
        >
          <Icon name="misc.chevron" size={14} />
        </button>

        <section className={cardClass('core', focused, false)}>
          <header>
            <h3>{t('cockpit.core')}</h3>
            <span className={`pill ${data?.status ?? 'optimal'}`}>{t(`dashboard.status.${data?.status ?? 'optimal'}` as never)}</span>
          </header>
          <ul className="cockpit-facts">
            <li>
              <b>{data?.provider.active ?? '—'}</b>
              <small>{data?.provider.model ?? t('settings.model')}</small>
            </li>
            <li>
              <b>{data?.activeAgents ?? 0}</b>
              <small>{t('dashboard.agents')}</small>
            </li>
            <li>
              <b>{data?.voice.status === 'ready' ? t('common.on') : t('common.off')}</b>
              <small>{t('dashboard.voice')}</small>
            </li>
          </ul>
          {state && (
            <div className="cockpit-bars">
              <Bar label={t('state.cortisol')} value={state.cortisol} />
              <Bar label={t('state.dopamine')} value={state.dopamine} />
              <Bar label={t('state.serotonin')} value={state.serotonin} />
              <Bar label={t('state.fatigue')} value={state.fatigue} />
              <p className="cockpit-meta">
                {t(`state.phase.${state.phase}` as never)} · {Number.isFinite(state.temperature) ? state.temperature.toFixed(2) : '—'}
              </p>
            </div>
          )}
        </section>

        <section className={cardClass('memory', focused, false)}>
          <button type="button" className="card-link" onClick={() => props.onNavigate('memory')} title={t('nav.memory')}>
            <h3>{t('cockpit.memory')}</h3>
            <Icon name="misc.chevron" size={13} />
          </button>
          <div className="cockpit-bars">
            <Bar label={t('memory.kind.semantic')} value={ratio(data?.memory.semantic, data?.memory.notes)} color="var(--accent)" />
            <Bar label={t('memory.kind.episodic')} value={ratio(data?.memory.episodic, data?.memory.notes)} color="var(--accent-soft)" />
            <Bar label={t('dashboard.bar.dormant')} value={ratio(data?.memory.dormant, data?.memory.notes)} color="var(--faint)" />
          </div>
          <ul className="cockpit-facts row">
            <li>
              <b>{data?.memory.notes ?? 0}</b>
              <small>{t('dashboard.fact.notes')}</small>
            </li>
            <li>
              <b>{data?.memory.conflicts ?? 0}</b>
              <small>{t('memory.conflictBadge')}</small>
            </li>
            <li>
              <b>{data?.memory.trauma ?? 0}</b>
              <small>{t('memory.traumaBadge')}</small>
            </li>
          </ul>
        </section>

        <section className={cardClass('system', focused, false)}>
          <header>
            <h3>{t('cockpit.system')}</h3>
            <span className="cockpit-meta">{formatUptime(data?.system.uptimeSec ?? 0, t)}</span>
          </header>
          <div className="cockpit-gauges">
            <Gauge label="CPU" value={data?.system.cpuPercent ?? 0} max={100} />
            <Gauge label="RAM" value={data?.system.rssMb ?? 0} max={1024} />
            <Gauge label={t('dashboard.gauge.heap')} value={data?.system.heapMb ?? 0} max={512} />
          </div>
          <ul className="cockpit-facts row">
            <li>
              <b>{data?.turns ?? 0}</b>
              <small>{t('dashboard.stat.turns')}</small>
            </li>
            <li>
              <b>{data?.toolCalls ?? 0}</b>
              <small>{t('dashboard.stat.tools')}</small>
            </li>
            <li>
              <b>{data?.pendingApprovals ?? 0}</b>
              <small>{t('dashboard.stat.approvals')}</small>
            </li>
          </ul>
        </section>
      </aside>

      {!isVisible(panels, 'left') && (
        <button
          type="button"
          className="panel-handle left"
          onClick={() => setPanels(togglePanel(panels, 'left'))}
          title={t('cockpit.showLeft')}
          aria-label={t('cockpit.showLeft')}
        >
          <Icon name="misc.chevron" size={14} />
        </button>
      )}

      <main className="cockpit-center">
        <div className={`cockpit-core ${data?.status ?? 'optimal'} ${props.listening ? 'listening' : ''}`}>
          <span className="ring r1" />
          <span className="ring r2" />
          <span className="ring r3" />
          <img src="/karen-mark-round.svg" alt="" width={168} height={168} />
        </div>
        <p className="cockpit-tagline">{t('dashboard.tagline')}</p>

        <div className="cockpit-actions">
          <RoundButton icon="action.mic" label={t('dashboard.talk')} onClick={props.onTalk} live={props.listening} />
          <RoundButton icon="status.thinking" label={t('memory.sleep')} onClick={props.onSleep} disabled={props.sleeping} />
          <RoundButton icon="nav.inbox" label={t('nav.inbox')} badge={data?.unreadInbox ?? 0} onClick={() => props.onNavigate('inbox')} />
          <RoundButton icon="nav.growth" label={t('nav.growth')} badge={data?.pendingProposals ?? 0} onClick={() => props.onNavigate('growth')} />
          <RoundButton icon="misc.palette" label={t('cockpit.zen')} onClick={() => setPanels(toggleZen(panels))} live={panels.zen} />
        </div>

        <div className="cockpit-strip">
          <Stat value={data?.turns ?? 0} label={t('dashboard.stat.turns')} />
          <Stat value={data?.toolCalls ?? 0} label={t('dashboard.stat.tools')} />
          <Stat value={data?.memory.conflicts ?? 0} label={t('dashboard.stat.conflicts')} />
          <Stat value={data?.pendingApprovals ?? 0} label={t('dashboard.stat.approvals')} />
        </div>
        <p className="cockpit-hint">
          {new Date().toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </main>

      <aside className={`cockpit-right ${isVisible(panels, 'right') ? '' : 'hidden'}`} aria-hidden={!isVisible(panels, 'right')}>
        <button
          type="button"
          className="panel-toggle"
          onClick={() => setPanels(togglePanel(panels, 'right'))}
          title={t('cockpit.collapseRight')}
          aria-label={t('cockpit.collapseRight')}
        >
          <Icon name="misc.chevron" size={14} />
        </button>

        <header className="cockpit-conversation-head">
          <h3>{t('cockpit.conversation')}</h3>
          <span className={`pill ${props.streaming ? 'busy' : 'optimal'}`}>
            {props.streaming ? t('chat.streaming') : t('common.on')}
          </span>
        </header>

        <div className="cockpit-conversation">
          <Chat messages={props.messages} streaming={props.streaming} />
        </div>

        {props.approvals.length > 0 && (
          <div className="cockpit-approvals">
            {props.approvals.map((approval) => (
              <ApprovalCard
                key={approval.requestId}
                approval={approval}
                onDecide={(allow) => props.onDecide(approval, allow)}
              />
            ))}
          </div>
        )}
      </aside>

      {!isVisible(panels, 'right') && (
        <button
          type="button"
          className="panel-handle right"
          onClick={() => setPanels(togglePanel(panels, 'right'))}
          title={t('cockpit.showRight')}
          aria-label={t('cockpit.showRight')}
        >
          <Icon name="misc.chevron" size={14} />
        </button>
      )}

      {panels.zen && (
        <button type="button" className="zen-exit" onClick={() => setPanels(toggleZen(panels))} title={t('cockpit.exitZen')}>
          <Icon name="misc.palette" size={14} />
          {t('cockpit.exitZen')}
        </button>
      )}
    </div>
  );
}

function Bar(props: { label: string; value: number; color?: string }): JSX.Element {
  const pct = Math.round(Math.min(1, Math.max(0, props.value)) * 100);
  return (
    <div className="cockpit-bar">
      <span>{props.label}</span>
      <div>
        <i style={{ width: `${pct}%`, background: props.color ?? 'var(--accent)' }} />
      </div>
      <b>{pct}</b>
    </div>
  );
}

function Gauge(props: { label: string; value: number; max: number }): JSX.Element {
  const ratioValue = props.max === 0 ? 0 : Math.min(1, props.value / props.max);
  const degrees = Math.round(ratioValue * 360);
  return (
    <div className="cockpit-gauge">
      <div className="dial" style={{ background: `conic-gradient(var(--accent) ${degrees}deg, rgba(255,255,255,0.05) ${degrees}deg)` }}>
        <span>{Math.round(props.value)}</span>
      </div>
      <small>{props.label}</small>
    </div>
  );
}

function RoundButton(props: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  badge?: number;
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
      <Icon name={props.icon} size={19} />
      <small>{props.label}</small>
      {props.badge !== undefined && props.badge > 0 && <span className="badge">{props.badge}</span>}
    </button>
  );
}

function Stat(props: { value: number; label: string }): JSX.Element {
  return (
    <div className="cockpit-stat">
      <b>{props.value}</b>
      <small>{props.label}</small>
    </div>
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

/** Events carry only text by the time the UI sees them, so the kind is inferred. */
function guessKind(text: string): string {
  if (/^memory_|note|intuition|trauma|sleep/i.test(text)) return 'memory_note';
  if (/^tool_|^run_|^read_|^list_|error/i.test(text)) return 'tool_result';
  if (/cortisol|dopamine|serotonin|fatigue|state/i.test(text)) return 'state_signal';
  return '';
}

function readStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(value: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // A blocked storage is not worth breaking the layout over.
  }
}
