import { useEffect, useState } from 'react';
import { getJson, postJson } from '../api.js';
import { useI18n } from '../i18n.js';
import { localeTag } from '../locale.js';

import type { Key } from '../../../shared/i18n/index.js';
import type { InboxItem } from '../../../server/autonomy/inbox.js';

const KIND_KEY: Record<InboxItem['kind'], Key> = {
  research: 'inbox.kind.research',
  suggestion: 'inbox.kind.suggestion',
  warning: 'inbox.kind.warning',
  shadow: 'inbox.kind.shadow',
};

type InboxBody = { items: InboxItem[]; unread: number };

function when(at: number, locale: string): string {
  return new Date(at).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Autonomous notes: only reads and marks as read; it produces no content. */
export function InboxScreen() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');

  async function load() {
    try {
      const body = await getJson<InboxBody>('/api/inbox');
      setItems(body.items);
      setUnread(body.unread);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  async function markRead(id: number) {
    try {
      await postJson<{ ok: boolean }>(`/api/inbox/${id}/read`, {});
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="inbox-screen">
      <header className="inbox-head">
        <h2>{t('inbox.title')}</h2>
        <span className="inbox-count">{t('inbox.unread', { count: unread })}</span>
      </header>
      {error !== '' && <p className="hint warn">{error}</p>}
      {items.length === 0 ? (
        <p className="empty">{t('inbox.empty')}</p>
      ) : (
        <ul className="inbox-list">
          {items.map((item) => (
            <li key={item.id} className={item.read ? 'read' : ''}>
              <span className={`inbox-kind ${item.kind}`}>{t(KIND_KEY[item.kind])}</span>
              <div className="inbox-body">
                <p>{item.text}</p>
                <small>{when(item.at, localeTag(locale))}</small>
              </div>
              <button className="cc-link" disabled={item.read} onClick={() => void markRead(item.id)}>
                {item.read ? t('inbox.read') : t('inbox.markRead')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
