import { useEffect, useState } from 'react';
import { getJson, patchJson, postJson, buildUrl } from '../api.js';
import type { PublicSettings } from '../../../server/settings.js';
import type { VoiceInfo } from '../../../server/voice/index.js';
import { listBrowserVoices, onVoicesReady, type BrowserVoice } from '../speech.js';
import { useI18n } from '../i18n.js';
import type { Locale, LocaleSetting } from '../../../shared/i18n/index.js';

type ProviderCard = PublicSettings['providerList'][number];

type SettingsView = PublicSettings & {
  providerInfo: { label: string; active: string; model: string; fellBack?: boolean; requested?: string };
};

export function SettingsScreen(props: {
  voice: VoiceInfo | null;
  onSaved: (message: string) => void;
  onVoiceChanged: () => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<SettingsView | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [voices, setVoices] = useState<BrowserVoice[]>(listBrowserVoices());
  const [probe, setProbe] = useState<{ ok: boolean; label?: string; ms?: number; reason?: string } | null>(null);

  useEffect(() => onVoicesReady(setVoices), []);

  useEffect(() => {
    void (async () => {
      try {
        setData(await getJson<SettingsView>('/api/settings'));
      } catch {
        /* server off */
      }
    })();
  }, []);

  async function refresh() {
    try {
      setData(await getJson<SettingsView>('/api/settings'));
    } catch {
      /* yok say */
    }
  }

  async function save(patch: Record<string, unknown>, message = t('common.saved')) {
    setSaving(true);
    try {
      const next = await patchJson<SettingsView>('/api/settings', patch);
      setData(next);
      props.onSaved(message);
      props.onVoiceChanged();
    } catch (err) {
      props.onSaved(t('settings.saveFailed', { detail: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  async function saveSecret(providerId: string) {
    if (keyInput.trim() === '') {
      props.onSaved(t('settings.keyMissing'));
      return;
    }
    setSaving(true);
    try {
      const next = await postJson<SettingsView>('/api/settings/secrets', { [providerId]: keyInput.trim() });
      setData(next);
      setKeyInput('');
      props.onSaved(t('settings.saved.key', { provider: providerId }));
    } catch (err) {
      props.onSaved(t('settings.keySaveFailed', { detail: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  async function testProvider() {
    setProbe(null);
    try {
      const res = await fetch(buildUrl('/api/settings/test'), { method: 'POST' });
      const body = (await res.json()) as { ok: boolean; label?: string; ms?: number; reason?: string };
      setProbe(body);
    } catch (err) {
      setProbe({ ok: false, reason: (err as Error).message });
    }
  }

  if (!data) return <p className="empty">{t('settings.loading')}</p>;

  const activeCard = data.providerList.find((item) => item.id === data.provider);
  const perProvider = data.providers?.[data.provider] ?? {};
  const browserVoices = voices;

  return (
    <section className="settings">
      <header className="settings-head">
        <h2>{t('settings.title')}</h2>
        <span className="settings-active">
          {t('settings.active')}: <b>{data.providerInfo.active}</b> · {t('settings.model')}: <b>{data.providerInfo.model}</b>
        </span>
        {data.providerInfo.fellBack && <span className="chip-warn">{t('settings.fellBack')}</span>}
      </header>

      <div className="settings-group">
        <h3>{t('settings.language')}</h3>
        <p className="hint">{t('settings.languageHint')}</p>
        <label className="field">
          <span>{t('settings.language')}</span>
          <select
            value={data.locale}
            onChange={(event) => {
              const next = event.target.value as LocaleSetting;
              void save({ locale: next }, t('common.saved'));
              props.onLocaleChange(next === 'tr' ? 'tr' : next === 'en' ? 'en' : props.locale);
            }}
          >
            <option value="auto">{t('settings.languageAuto')}</option>
            {/* Language names stay in their own language: a Turkish user looks for "Türkçe". */}
            <option value="tr">{/* i18n-exempt */}Türkçe</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      <div className="settings-group">
        <h3>{t('settings.provider')}</h3>
        <p className="hint">
          {t('settings.providerHint', {
            local: data.providerList.filter((item) => item.local).length,
            cloud: data.providerList.filter((item) => !item.local).length,
          })}
        </p>
        <div className="provider-grid">
          {data.providerList.map((card: ProviderCard) => (
            <button
              key={card.id}
              className={`provider-card ${data.provider === card.id ? 'active' : ''}`}
              onClick={() => void save({ provider: card.id }, t('settings.saved.provider', { label: card.label }))}
              disabled={saving}
            >
              <span className="provider-name">
                {card.label}
                {card.configured && <em className="ok"> ✓</em>}
              </span>
              <span className="provider-hint">
                {card.local
                  ? t('settings.providerLocal')
                  : card.configured
                    ? t('settings.providerKeyed')
                    : card.requiresKey
                      ? t('settings.providerNeedsKey')
                      : t('settings.providerReady')}
                {card.hint && card.hint !== 'yerel' && card.hint !== 'bulut' ? ` · ${card.hint}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <h3>{t('settings.modelSection')}</h3>
        <label className="field">
          <span>{t('settings.modelName')}</span>
          <input
            value={data.model}
            onChange={(event) => setData({ ...data, model: event.target.value })}
            onBlur={() => void save({ model: data.model }, t('settings.saved.model'))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save({ model: data.model }, t('settings.saved.model'));
            }}
            placeholder="llama3.1 · claude-sonnet-4 · gemini-2.0-flash · gpt-4o-mini"
          />
        </label>

        {(activeCard?.id === 'custom' || activeCard?.local === false) && (
          <label className="field">
            <span>
              {activeCard?.id === 'custom'
                ? t('settings.baseUrlRequired')
                : `${t('settings.baseUrl')} (${t('common.optional')})`}
            </span>
            <input
              value={perProvider.baseUrl ?? ''}
              onChange={(event) =>
                setData({
                  ...data,
                  providers: { ...data.providers, [data.provider]: { ...perProvider, baseUrl: event.target.value } },
                })
              }
              onBlur={() =>
                void save({ providers: { ...data.providers, [data.provider]: { ...perProvider } } }, t('settings.saved.baseUrl'))
              }
              placeholder="https://ornek/v1"
            />
          </label>
        )}

        {activeCard?.id === 'azure-openai' && (
          <>
            <label className="field">
              <span>{t('settings.deployment')}</span>
              <input
                value={perProvider.deployment ?? ''}
                onChange={(event) =>
                  setData({
                    ...data,
                    providers: { ...data.providers, azure: { ...perProvider, deployment: event.target.value } },
                  })
                }
                onBlur={() => void save({ providers: { ...data.providers, [data.provider]: { ...perProvider } } })}
                placeholder="gpt-4o"
              />
            </label>
            <label className="field">
              <span>api-version</span>
              <input
                value={perProvider.apiVersion ?? '2024-10-21'}
                onChange={(event) =>
                  setData({
                    ...data,
                    providers: { ...data.providers, [data.provider]: { ...perProvider, apiVersion: event.target.value } },
                  })
                }
                onBlur={() => void save({ providers: { ...data.providers, [data.provider]: { ...perProvider } } })}
              />
            </label>
          </>
        )}

        <div className="settings-actions">
          <button onClick={() => void testProvider()} disabled={saving}>
            {t('settings.testConnection')}
          </button>
        </div>
        {probe && (
          <p className={`hint ${probe.ok ? '' : 'warn'}`}>
            {probe.ok
              ? t('settings.connectionOk', { label: probe.label ?? '', ms: probe.ms ?? '' })
              : t('settings.connectionFailed', {
                  reason: (probe.reason ?? t('common.unknownError')).replace(/\s+/g, ' ').slice(0, 160),
                })}
          </p>
        )}
      </div>

      <div className="settings-group">
        <h3>{t('settings.apiKey', { provider: activeCard?.label ?? data.provider })}</h3>
        <p className="hint">
          {data.secrets[data.provider]
            ? t('settings.apiKeyStored')
            : data.envKeys[data.provider]
              ? t('settings.apiKeyEnv')
              : activeCard?.requiresKey
                ? t('settings.apiKeyRequired')
                : t('settings.apiKeyNotNeeded')}
        </p>
        <label className="field">
          <span>{t('settings.apiKeyInput')}</span>
          <input
            type="password"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            placeholder="sk-… / gsk_… / AIza…"
            autoComplete="off"
          />
        </label>
        <div className="settings-actions">
          <button className="primary" onClick={() => void saveSecret(data.provider)} disabled={saving}>
            {t('common.save')}
          </button>
        </div>
      </div>

      <div className="settings-group">
        <h3>{t('settings.voice')}</h3>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={data.speakReplies}
            onChange={(event) => void save({ speakReplies: event.target.checked })}
          />
          <span>{t('settings.speakReplies')}</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={data.wakeWord}
            onChange={(event) => void save({ wakeWord: event.target.checked }, t('settings.saved.wakeWord'))}
          />
          <span>
            {t('settings.wakeWord')} <em className="warn">{t('settings.wakeWordWarn')}</em>
          </span>
        </label>
        <label className="field">
          <span>{t('settings.voiceLang')}</span>
          <select
            value={data.voiceLang}
            onChange={(event) => {
              void save({ voiceLang: event.target.value }, t('settings.saved.voiceLang'));
              props.onVoiceChanged();
            }}
          >
            <option value="tr-TR">{t('settings.voiceLangTurkish')}</option>
            <option value="en-US">{t('settings.voiceLangEnglish')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('settings.voiceName')}</span>
          <select
            value={data.voiceName ?? ''}
            onChange={(event) => void save({ voiceName: event.target.value === '' ? null : event.target.value })}
          >
            <option value="">{t('settings.voiceAuto', { lang: data.voiceLang })}</option>
            {browserVoices.map((voice) => (
              <option key={voice.name} value={voice.name}>
                {voice.name} · {voice.lang}
                {voice.local ? ` · ${t('settings.voiceLocal')}` : ''}
              </option>
            ))}
          </select>
        </label>
        {browserVoices.length === 0 && (
          <p className="hint warn">{t('settings.voiceListEmpty')}</p>
        )}
        {browserVoices.length > 0 && !browserVoices.some((v) => v.lang.toLowerCase().startsWith('tr')) && (
          <p className="hint warn">
            {t('settings.voiceNoTurkish')}
          </p>
        )}
        {props.voice && (
          <p className="hint">
            {t('settings.voiceLocalRecognition')}:{' '}
            <b>
              {props.voice.status === 'ready'
                ? t('settings.voiceStatus.ready')
                : props.voice.status === 'no-model'
                  ? t('settings.voiceStatus.noModel')
                  : t('settings.voiceStatus.unavailable')}
            </b>{' '}
            · {t('settings.voicePrivacy')}
          </p>
        )}
      </div>

      <div className="settings-group">
        <h3>{t('settings.autonomy')}</h3>
        <p className="hint">
          {t('settings.autonomyHint')}
        </p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={data.autonomy.enabled}
            onChange={(event) =>
              void save(
                { autonomy: { ...data.autonomy, enabled: event.target.checked } },
                event.target.checked ? t('settings.saved.autonomyOn') : t('settings.saved.autonomyOff'),
              )
            }
          />
          <span>{t('settings.autonomyEnabled')}</span>
        </label>
        <label className="field">
          <span>{t('settings.autonomyIdle')}</span>
          <input
            type="number"
            min={5}
            max={240}
            value={data.autonomy.idleMinutes}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value)) return;
              setData({ ...data, autonomy: { ...data.autonomy, idleMinutes: value } });
            }}
            onBlur={() => void save({ autonomy: { ...data.autonomy } }, t('settings.saved.idle'))}
          />
        </label>
        <label className="field">
          <span>{t('settings.autonomyDaily')}</span>
          <input
            type="number"
            min={0}
            max={96}
            value={data.autonomy.dailyRuns}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value)) return;
              setData({ ...data, autonomy: { ...data.autonomy, dailyRuns: value } });
            }}
            onBlur={() => void save({ autonomy: { ...data.autonomy } }, t('settings.saved.daily'))}
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={data.autonomy.research}
            onChange={(event) =>
              void save(
                { autonomy: { ...data.autonomy, research: event.target.checked } },
                t('settings.saved.research'),
              )
            }
          />
          <span>
            {t('settings.autonomyResearch')} <em className="warn">{t('settings.autonomyResearchWarn')}</em>
          </span>
        </label>
      </div>

      <div className="settings-group">
        <h3>{t('settings.behaviour')}</h3>
        <label className="field">
          <span>{t('settings.maxBackground', { count: data.maxBackground })}</span>
          <input
            type="range"
            min={1}
            max={6}
            value={data.maxBackground}
            onChange={(event) => setData({ ...data, maxBackground: Number(event.target.value) })}
            onMouseUp={() => void save({ maxBackground: data.maxBackground })}
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={data.allowPaidSleep}
            onChange={(event) => void save({ allowPaidSleep: event.target.checked }, t('settings.saved.paidSleep'))}
          />
          <span>
            {t('settings.allowPaidSleep')} <em className="warn">{t('settings.allowPaidSleepWarn')}</em>
          </span>
        </label>
        <button className="dash-ghost" onClick={() => void refresh()}>
          {t('common.refresh')}
        </button>
      </div>
    </section>
  );
}
