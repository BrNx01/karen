import { useEffect, useState, type JSX } from 'react';
import { buildUrl, getJson, patchJson, postJson } from '../api.js';
import type { PublicSettings, Settings } from '../../../server/settings.js';
import { useI18n } from '../i18n.js';
import { Icon } from '../icons.js';
import { SECTIONS, splitKey, type SettingsField, type SettingsKey } from '../settings-model.js';
import type { Key, Locale } from '../../../shared/i18n/index.js';

type ProbeResponse =
  | { ok: true; kind: string; providerId: string; address: string; models: { id: string; context?: number }[] }
  | { ok: false; error: string };

const PROVIDER_LABEL: Record<string, string> = { evren: 'EVREN (SSB)' };

/**
 * The settings screen: a section list on the left, the active section's cards on the
 * right. Every control writes through PATCH /api/settings; the Model section can also
 * ask an endpoint what it serves and then pick from that list.
 */
export function SettingsScreen(props: {
  onSaved: (message: string) => void;
  onVoiceChanged: () => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [section, setSection] = useState(SECTIONS[0]!.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Model section working state.
  const [address, setAddress] = useState('');
  const [key, setKey] = useState('');
  const [models, setModels] = useState<{ id: string; context?: number }[]>([]);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await getJson<PublicSettings>('/api/settings');
        setSettings(data);
        setAddress(data.baseUrl !== '' ? data.baseUrl : (data.providers?.[data.provider]?.baseUrl ?? ''));
      } catch {
        setError(t('settings.loading'));
      }
    })();
    // Loaded once: every later change writes to the server and re-reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch: Partial<Settings>): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const next = await patchJson<PublicSettings>('/api/settings', patch);
      setSettings(next);
      props.onSaved('');
      if (typeof patch.locale === 'string') {
        const resolved = patch.locale === 'auto' ? props.locale : (patch.locale as Locale);
        props.onLocaleChange(resolved);
      }
      if ('speakReplies' in patch || 'voiceSpeed' in patch || 'wakeWord' in patch) props.onVoiceChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function detect(): Promise<void> {
    if (address.trim() === '') {
      setProbeError(t('settings.addressRequired'));
      return;
    }
    setProbing(true);
    setProbeError(null);
    setDetected(null);
    try {
      const result = await postJson<ProbeResponse>('/api/settings/probe', { address, key });
      if (!result.ok) {
        setProbeError(`${t('settings.detectFailed')}: ${result.error}`);
        setModels([]);
        return;
      }
      setModels(result.models);
      setDetected(result.providerId);
      // Remember the endpoint and the first model, so the fields below are usable at once.
      await save({
        provider: result.providerId,
        model: result.models[0]?.id ?? settings?.model ?? '',
        baseUrl: result.address,
        providers: { ...(settings?.providers ?? {}), [result.providerId]: { baseUrl: result.address, model: result.models[0]?.id ?? '' } } as Settings['providers'],
      });
      if (key !== '') {
        await postJson('/api/settings/secrets', { [result.providerId.split(':')[0] ?? result.providerId]: key });
        props.onSaved(t('settings.probedOk', { count: result.models.length }));
        setKey('');
      } else {
        props.onSaved(t('settings.probedOk', { count: result.models.length }));
      }
    } catch (err) {
      setProbeError(`${t('settings.detectFailed')}: ${(err as Error).message}`);
    } finally {
      setProbing(false);
    }
  }

  function valueOf(key: SettingsKey): unknown {
    if (!settings) return undefined;
    const [head, tail] = splitKey(key);
    const value = (settings as unknown as Record<string, unknown>)[head as string];
    if (tail === undefined) return value;
    return (value as Record<string, unknown> | undefined)?.[tail];
  }

  function writeField(field: SettingsField, raw: string | boolean | number): void {
    const [head, tail] = splitKey(field.key);
    if (tail !== undefined) {
      const current = (settings as unknown as Record<string, unknown>)[head as string] as Record<string, unknown>;
      void save({ [head as string]: { ...current, [tail]: raw } } as Partial<Settings>);
      return;
    }
    void save({ [head as string]: raw } as Partial<Settings>);
  }

  if (!settings) {
    return <div className="settings-empty">{error ?? t('settings.loading')}</div>;
  }

  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]!;

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label={t('settings.title')}>
        <h2>{t('settings.title')}</h2>
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === active.id ? 'active' : ''}
            onClick={() => setSection(item.id)}
            data-section={item.id}
          >
            {t(item.titleKey)}
          </button>
        ))}
        <p className="settings-active">
          {settings.provider} · {settings.model}
        </p>
      </nav>

      <div className="settings-body">
        {error && <p className="settings-error">{error}</p>}

        {active.id === 'model' && (
          <section className="settings-card settings-probe">
            <label>
              <span>{t('settings.baseUrl')}</span>
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
              />
            </label>
            <p className="settings-hint">{t('settings.baseUrlHint')}</p>

            <label>
              <span>{t('settings.apiKey', { provider: settings.provider })}</span>
              <input
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={settings.secrets[settings.provider] ? t('settings.apiKeyStored') : t('settings.apiKeyInput')}
                spellCheck={false}
              />
            </label>

            <div className="settings-row">
              <button type="button" className="settings-primary" onClick={() => void detect()} disabled={probing || saving}>
                <Icon name={probing ? 'status.thinking' : 'action.refresh'} size={16} />
                {probing ? t('settings.detecting') : t('settings.detect')}
              </button>
              {detected && <span className="settings-ok">{PROVIDER_LABEL[detected] ?? detected}</span>}
              {models.length > 0 && <span className="settings-ok">{t('settings.probedOk', { count: models.length })}</span>}
            </div>

            {probeError && <p className="settings-error">{probeError}</p>}
          </section>
        )}

        <section className="settings-card">
          {active.fields.map((field) => (
            <Field
              key={`${active.id}-${String(field.key)}`}
              field={field}
              value={valueOf(field.key)}
              models={models}
              saving={saving}
              onWrite={(raw) => writeField(field, raw)}
              onProbe={() => void detect()}
              probing={probing}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

function Field(props: {
  field: SettingsField;
  value: unknown;
  models: { id: string; context?: number }[];
  saving: boolean;
  onWrite: (raw: string | boolean | number) => void;
  onProbe: () => void;
  probing: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const { field } = props;

  // The address and the key are drawn by the probe card above.
  if (field.key === 'baseUrl') return null;
  if (field.key === 'probe') return null;

  const label = (
    <>
      <span>{t(field.labelKey)}</span>
      {field.hintKey && <small>{t(field.hintKey)}</small>}
    </>
  );

  if (field.kind === 'readonly') {
    return (
      <div className="settings-field">
        <label>{label}</label>
        <p className="settings-value">{String(props.value ?? '—')}</p>
      </div>
    );
  }

  if (field.kind === 'toggle') {
    return (
      <div className="settings-field settings-toggle">
        <label>{label}</label>
        <button
          type="button"
          role="switch"
          aria-checked={props.value === true}
          className={props.value === true ? 'on' : ''}
          disabled={props.saving}
          onClick={() => props.onWrite(props.value !== true)}
        >
          <Icon name={props.value === true ? 'action.approve' : 'action.reject'} size={13} />
        </button>
      </div>
    );
  }

  if (field.kind === 'select') {
    const options: { value: string; labelKey?: Key; label?: string }[] =
      field.key === 'model' && props.models.length > 0
        ? props.models.map((m) => ({ value: m.id, label: m.context ? `${m.id} · ${Math.round(m.context / 1000)}k` : m.id }))
        : (field.options ?? []);
    return (
      <div className="settings-field">
        <label>{label}</label>
        <select value={String(props.value ?? '')} disabled={props.saving} onChange={(event) => props.onWrite(event.target.value)}>
          {options.length === 0 && <option value={String(props.value ?? '')}>{String(props.value ?? '—')}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.labelKey ? t(option.labelKey) : (option.label ?? option.value)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.kind === 'number') {
    return (
      <div className="settings-field">
        <label>{label}</label>
        <input
          type="number"
          value={Number(props.value ?? 0)}
          disabled={props.saving}
          onChange={(event) => props.onWrite(Number(event.target.value))}
        />
      </div>
    );
  }

  if (field.kind === 'hour') {
    const hour = props.value === null || props.value === undefined ? -1 : Number(props.value);
    return (
      <div className="settings-field">
        <label>{label}</label>
        <select value={String(hour)} disabled={props.saving} onChange={(event) => props.onWrite(Number(event.target.value))}>
          <option value="-1">{t('settings.consolidationOff')}</option>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </select>
      </div>
    );
  }

  /** Text fields (fallbackModel and anything added later). */
  return (
    <div className="settings-field">
      <label>{label}</label>
      <input value={String(props.value ?? '')} disabled={props.saving} onChange={(event) => props.onWrite(event.target.value)} />
    </div>
  );
}
