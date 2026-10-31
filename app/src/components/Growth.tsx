import { useEffect, useState } from 'react';
import { getJson, buildUrl } from '../api.js';
import { useI18n } from '../i18n.js';
import { localeTag } from '../locale.js';

import type { Key } from '../../../shared/i18n/index.js';

type Proposal = {
  id: string;
  createdAt: number;
  kind: 'identity' | 'rule' | 'skill' | 'code';
  title: string;
  reason: string;
  files: { path: string; before: string; after: string }[];
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'checking' | 'ready' | 'rejected' | 'applied' | 'reverted';
  checks: { name: string; ok: boolean; detail: string }[];
  commit?: string;
  appliedAt?: number;
};

type Payload = { proposals: Proposal[]; codeEditsEnabled: boolean };

const KIND_KEY: Record<Proposal['kind'], Key> = {
  identity: 'growth.kind.identity',
  rule: 'growth.kind.rule',
  skill: 'growth.kind.skill',
  code: 'growth.kind.code',
};

const RISK_KEY: Record<Proposal['risk'], Key> = {
  low: 'growth.risk.low',
  medium: 'growth.risk.medium',
  high: 'growth.risk.high',
};

const STATUS_KEY: Record<Proposal['status'], Key> = {
  pending: 'growth.status.pending',
  checking: 'growth.status.checking',
  ready: 'growth.status.ready',
  rejected: 'growth.status.rejected',
  applied: 'growth.status.applied',
  reverted: 'growth.status.reverted',
};

export function GrowthScreen(props: { onMessage: (text: string) => void }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    try {
      setData(await getJson<Payload>('/api/growth'));
    } catch {
      /* server off */
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, []);

  async function act(id: string, action: 'apply' | 'revert' | 'reject') {
    setBusy(id);
    try {
      const res = await fetch(buildUrl(`/api/growth/${id}/${action}`), { method: 'POST' });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      props.onMessage(
        body.ok
          ? t(action === 'apply' ? 'growth.applied' : action === 'revert' ? 'growth.reverted' : 'growth.rejected')
          : `${t('common.error')}: ${body.error ?? res.status}`,
      );
      await load();
    } catch (err) {
      props.onMessage(`${t('common.error')}: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <p className="empty">{t('growth.loading')}</p>;

  const pending = data.proposals.filter((p) => p.status === 'ready' || p.status === 'checking');
  const history = data.proposals.filter((p) => p.status !== 'ready' && p.status !== 'checking').slice(-12).reverse();

  return (
    <section className="skills">
      <div className="memory-head">
        <h2>{t('growth.title')}</h2>
        <span className="map-stats">
          {t('growth.pending', { count: pending.length })} ·{' '}
          {data.codeEditsEnabled ? t('growth.codeEnabled') : t('growth.codeDisabled')}
        </span>
      </div>
      <p className="hint">{t('growth.hint')}</p>
      {!data.codeEditsEnabled && <p className="hint warn">{t('growth.codeDisabledHint')}</p>}

      {pending.length === 0 && <p className="empty">{t('growth.empty')}</p>}

      <div className="memory-list">
        {pending.map((proposal) => (
          <article key={proposal.id} className={`note proposal ${proposal.risk}`}>
            <div className="note-head">
              <span className="tag">{t(KIND_KEY[proposal.kind])}</span>
              <span className={`tag risk-${proposal.risk}`}>{t(RISK_KEY[proposal.risk])}</span>
              <span className="note-meta">{t(STATUS_KEY[proposal.status])}</span>
            </div>
            <p className="note-text">
              <b>{proposal.title}</b>
            </p>
            <p className="hint">{proposal.reason}</p>
            <p className="note-evidence">
              {proposal.files.map((file) => file.path).join(' · ')}
            </p>
            <div className="repo-actions">
              <button className="primary" disabled={busy === proposal.id} onClick={() => void act(proposal.id, 'apply')}>
                {t('common.apply')}
              </button>
              <button disabled={busy === proposal.id} onClick={() => setOpenId(openId === proposal.id ? null : proposal.id)}>
                {openId === proposal.id ? t('growth.hideDiff') : t('growth.showDiff')}
              </button>
              <button disabled={busy === proposal.id} onClick={() => void act(proposal.id, 'reject')}>
                {t('common.reject')}
              </button>
            </div>
            {openId === proposal.id && (
              <div className="proposal-diff">
                {proposal.files.map((file) => (
                  <div key={file.path}>
                    <p className="note-evidence">{file.path}</p>
                    <pre className="diff">{file.after.slice(0, 4000)}</pre>
                  </div>
                ))}
                <ul className="map-detail-meta">
                  {proposal.checks.map((check) => (
                    <li key={check.name} className={check.ok ? '' : 'warn'}>
                      {check.ok ? '✓' : '✗'} {check.name}: {check.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ))}
      </div>

      {history.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>{t('growth.history')}</h2>
          <div className="memory-list">
            {history.map((proposal) => (
              <article key={proposal.id} className="note">
                <div className="note-head">
                  <span className="tag">{t(KIND_KEY[proposal.kind])}</span>
                  <span className="note-meta">
                    {t(STATUS_KEY[proposal.status])} ·{' '}
                    {new Date(proposal.appliedAt ?? proposal.createdAt).toLocaleString(localeTag(locale))}
                  </span>
                </div>
                <p className="note-text">{proposal.title}</p>
                {proposal.status === 'applied' && (
                  <div className="repo-actions">
                    <button disabled={busy === proposal.id} onClick={() => void act(proposal.id, 'revert')}>
                      {t('common.revert')}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
