import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Icon } from '../icons.js';
import { useI18n } from '../i18n.js';
import { RAIL, shouldCollapse } from '../shell.js';
import type { StageScreen } from '../screens.js';

/**
 * The frame: an icon rail, one stage, a context panel and a composer that never
 * leaves. Screens keep their own layout; this only decides where they sit.
 */
export function AppShell(props: {
  screen: StageScreen;
  onNavigate: (screen: StageScreen) => void;
  title: string;
  topbarRight?: ReactNode;
  context?: ReactNode;
  composer: ReactNode;
  children: ReactNode;
  badges?: Partial<Record<StageScreen, number | null>>;
  connected: boolean;
  listening: boolean;
  onTalk: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [narrow, setNarrow] = useState(() => shouldCollapse(window.innerWidth));
  const [contextOpen, setContextOpen] = useState(false);

  useEffect(() => {
    const onResize = (): void => setNarrow(shouldCollapse(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className={`shell ${narrow ? 'narrow' : ''} ${contextOpen ? 'context-open' : ''}`}>
      <nav className="rail" aria-label={t('nav.overview')}>
        <button
          type="button"
          className="rail-mark"
          onClick={() => props.onNavigate('overview')}
          title="KAREN"
          aria-label="KAREN"
        >
          <img src="/karen-mark.svg" alt="" width={28} height={28} />
        </button>

        <div className="rail-items">
          {RAIL.filter((item) => item.id !== 'settings').map((item) => {
            const badge = props.badges?.[item.id] ?? null;
            return (
              <button
                key={item.id}
                type="button"
                className={`rail-item ${props.screen === item.id ? 'active' : ''}`}
                onClick={() => props.onNavigate(item.id)}
                title={t(item.labelKey)}
                aria-label={t(item.labelKey)}
                aria-current={props.screen === item.id ? 'page' : undefined}
                data-screen={item.id}
              >
                <Icon name={item.icon} size={20} />
                {badge !== null && badge > 0 && <span className="rail-badge">{badge}</span>}
              </button>
            );
          })}
        </div>

        <div className="rail-foot">
          <button
            type="button"
            className={`rail-item ${props.listening ? 'live' : ''}`}
            onClick={props.onTalk}
            title={t('dashboard.talk')}
            aria-label={t('dashboard.talk')}
          >
            <Icon name="action.mic" size={20} />
          </button>
          <button
            type="button"
            className={`rail-item ${props.screen === 'settings' ? 'active' : ''}`}
            onClick={() => props.onNavigate('settings')}
            title={t('nav.settings')}
            aria-label={t('nav.settings')}
            data-screen="settings"
          >
            <Icon name="nav.settings" size={20} />
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <h1>{props.title}</h1>
          <div className="topbar-chips">{props.topbarRight}</div>
          <span className={`conn ${props.connected ? 'on' : 'off'}`} title={props.connected ? t('common.enabled') : t('app.offline')}>
            <Icon name={props.connected ? 'status.online' : 'status.offline'} size={16} />
          </span>
          {props.context && (
            <button
              type="button"
              className="topbar-context"
              onClick={() => setContextOpen((open) => !open)}
              aria-expanded={contextOpen}
              aria-label="context"
            >
              <Icon name="misc.chevron" size={16} />
            </button>
          )}
        </header>

        <main className="stage">{props.children}</main>

        <div className="composer">{props.composer}</div>
      </div>

      {props.context && (
        <aside className="context" aria-label="context">
          {props.context}
        </aside>
      )}
    </div>
  );
}
