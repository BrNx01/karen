import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROVIDERS, providerList } from './engine/providers/registry.js';
import { isLocaleSetting, type LocaleSetting } from '../shared/i18n/index.js';


export type ProviderId = string;

export type ProviderConfig = {
  baseUrl?: string;
  model?: string;
  apiVersion?: string;
  deployment?: string;
};

export type AutonomySettings = {
  enabled: boolean;
  idleMinutes: number;
  dailyRuns: number;
  research: boolean;
};

export type Settings = {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  speakReplies: boolean;
  voiceLang: 'tr-TR' | 'en-US';
  voiceName: string | null;
  wakeWord: boolean;
  maxBackground: number;
  allowPaidSleep: boolean;
  /** Interface language; the model reply language is independent of it. */
  locale: LocaleSetting;
  /** Per-provider extra settings (each provider keeps its own key/address). */
  providers: Record<string, ProviderConfig>;
  /** Autonomous background work; off by default, the user turns it on. */
  autonomy: AutonomySettings;
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'ollama',
  model: 'llama3.1',
  baseUrl: '',
  speakReplies: true,
  voiceLang: 'tr-TR',
  voiceName: null,
  wakeWord: false,
  maxBackground: 3,
  allowPaidSleep: false,
  locale: 'auto',
  providers: {},
  autonomy: { enabled: false, idleMinutes: 30, dailyRuns: 24, research: true },
};

export type Secrets = Record<string, string>;

/** Shape returned to the UI: secrets are masked, only "is it set" information leaves. */
export type PublicSettings = Settings & {
  secrets: Record<string, boolean>;
  envKeys: Record<string, boolean>;
  providerList: {
    id: string;
    label: string;
    hint: string;
    local: boolean;
    requiresKey: boolean;
    configured: boolean;
    active: boolean;
  }[];
};

const SECRET_KEYS = ['anthropic', 'openai'] as const;

export class SettingsStore {
  constructor(
    private readonly dataDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private get settingsPath(): string {
    return join(this.dataDir, 'settings.json');
  }

  private get secretsPath(): string {
    return join(this.dataDir, 'secrets.json');
  }

  get(): Settings {
    const base = { ...DEFAULT_SETTINGS, autonomy: { ...DEFAULT_SETTINGS.autonomy } };
    if (!existsSync(this.settingsPath)) return base;
    try {
      const raw = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Partial<Settings>;
      const clean = sanitize(raw);
      return { ...base, ...clean, autonomy: clean.autonomy ?? base.autonomy };
    } catch {
      return base;
    }
  }

  set(patch: Partial<Settings>): Settings {
    const next = { ...this.get(), ...sanitize(patch) };
    this.writeJson(this.settingsPath, next);
    return next;
  }

  secrets(): Secrets {
    if (!existsSync(this.secretsPath)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.secretsPath, 'utf8')) as Record<string, unknown>;
      const out: Secrets = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string' && value.trim() !== '' && /^[a-z0-9-]{1,40}$/i.test(key)) {
          out[key] = value.trim();
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  /** An empty string means "delete"; a missing field is left untouched. */
  setSecrets(patch: Record<string, unknown>): void {
    const current = this.secrets();
    for (const [key, value] of Object.entries(patch)) {
      if (!/^[a-z0-9-]{1,40}$/i.test(key)) continue;
      if (typeof value !== 'string') continue;
      if (value.trim() === '') delete current[key];
      else current[key] = value.trim();
    }
    this.writeJson(this.secretsPath, current);
  }

  /** Effective key for a provider: disk > environment variable. */
  apiKey(id: string): string | undefined {
    const stored = this.secrets()[id];
    if (stored) return stored;
    const spec = PROVIDERS.find((item) => item.id === id);
    const envName = spec?.apiKeyEnv;
    return envName ? this.env[envName] || undefined : undefined;
  }

  public(): PublicSettings {
    const secrets = this.secrets();
    const secretsMask: Record<string, boolean> = {};
    const envKeys: Record<string, boolean> = {};
    for (const spec of PROVIDERS) {
      secretsMask[spec.id] = (secrets[spec.id] ?? '') !== '';
      envKeys[spec.id] = spec.apiKeyEnv ? (this.env[spec.apiKeyEnv] ?? '') !== '' : false;
    }
    const settings = this.get();
    return {
      ...settings,
      secrets: secretsMask,
      envKeys,
      providerList: providerList(secretsMask).map((item) => ({
        ...item,
        active: settings.provider === item.id,
      })),
    };
  }

  private writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    renameSync(tmp, path);
  }
}

function sanitize(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof patch.provider === 'string' && isValidProvider(patch.provider)) out.provider = patch.provider;
  if (typeof patch.model === 'string') out.model = patch.model.trim().slice(0, 120);
  if (typeof patch.baseUrl === 'string') out.baseUrl = patch.baseUrl.trim().slice(0, 300);
  if (typeof patch.speakReplies === 'boolean') out.speakReplies = patch.speakReplies;
  if (patch.voiceLang === 'tr-TR' || patch.voiceLang === 'en-US') out.voiceLang = patch.voiceLang;
  if (isLocaleSetting(patch.locale)) out.locale = patch.locale;
  if (patch.voiceName === null || typeof patch.voiceName === 'string') {
    out.voiceName = patch.voiceName === null ? null : patch.voiceName.slice(0, 120);
  }
  if (typeof patch.wakeWord === 'boolean') out.wakeWord = patch.wakeWord;
  if (typeof patch.maxBackground === 'number' && Number.isFinite(patch.maxBackground)) {
    out.maxBackground = Math.min(6, Math.max(1, Math.round(patch.maxBackground)));
  }
  if (typeof patch.allowPaidSleep === 'boolean') out.allowPaidSleep = patch.allowPaidSleep;
  if (patch.providers && typeof patch.providers === 'object') {
    const providers: Record<string, ProviderConfig> = {};
    for (const [id, raw] of Object.entries(patch.providers as Record<string, unknown>)) {
      if (!/^[a-z0-9-]{1,40}$/i.test(id) || !raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      providers[id] = {
        ...(typeof entry['baseUrl'] === 'string' ? { baseUrl: entry['baseUrl'].trim().slice(0, 300) } : {}),
        ...(typeof entry['model'] === 'string' ? { model: entry['model'].trim().slice(0, 120) } : {}),
        ...(typeof entry['apiVersion'] === 'string' ? { apiVersion: entry['apiVersion'].trim().slice(0, 40) } : {}),
        ...(typeof entry['deployment'] === 'string' ? { deployment: entry['deployment'].trim().slice(0, 120) } : {}),
      };
    }
    out.providers = providers;
  }
  if (patch.autonomy && typeof patch.autonomy === 'object') {
    const raw = patch.autonomy as Record<string, unknown>;
    const base = DEFAULT_SETTINGS.autonomy;
    out.autonomy = {
      enabled: typeof raw['enabled'] === 'boolean' ? raw['enabled'] : base.enabled,
      idleMinutes: clampInt(raw['idleMinutes'], 5, 240, base.idleMinutes),
      dailyRuns: clampInt(raw['dailyRuns'], 0, 96, base.dailyRuns),
      research: typeof raw['research'] === 'boolean' ? raw['research'] : base.research,
    };
  }
  return out;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isValidProvider(value: string): value is ProviderId {
  return /^[a-z0-9-]{1,40}$/i.test(value);
}
