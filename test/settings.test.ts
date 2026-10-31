import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, SettingsStore } from '../server/settings.js';
import { buildProvider } from '../server/engine/switchable.js';

const dir = () => mkdtempSync(join(tmpdir(), 'karen-settings-'));

describe('SettingsStore', () => {
  it('returns defaults when the file is missing', () => {
    const store = new SettingsStore(dir(), {});
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and reads back', () => {
    const dataDir = dir();
    const store = new SettingsStore(dataDir, {});
    store.set({ provider: 'anthropic', model: 'claude-sonnet-4', speakReplies: false });
    const reread = new SettingsStore(dataDir, {}).get();
    expect(reread.provider).toBe('anthropic');
    expect(reread.model).toBe('claude-sonnet-4');
    expect(reread.speakReplies).toBe(false);
  });

  it('clamps invalid values and does not corrupt the file', () => {
    const store = new SettingsStore(dir(), {});
    const saved = store.set({ provider: 'yok' as never, maxBackground: 99, model: '  x  ' });
    expect(saved.provider).toBe('yok');
    expect(saved.maxBackground).toBe(6);
    expect(saved.model).toBe('x');
  });

  it('locale defaults to auto and rejects junk', () => {
    const store = new SettingsStore(dir(), {});
    expect(store.get().locale).toBe('auto');
    expect(store.set({ locale: 'en' as never }).locale).toBe('en');
    expect(store.set({ locale: 'tr' as never }).locale).toBe('tr');
    expect(store.set({ locale: 'xx' as never }).locale).toBe('tr');
  });

  it('autonomy settings have defaults and bounds', () => {
    const store = new SettingsStore(dir(), {});
    expect(store.get().autonomy).toEqual({ enabled: false, idleMinutes: 30, dailyRuns: 24, research: true });

    const saved = store.set({ autonomy: { enabled: true, idleMinutes: 9999, dailyRuns: -5, research: false } } as never);
    expect(saved.autonomy.enabled).toBe(true);
    expect(saved.autonomy.idleMinutes).toBe(240);
    expect(saved.autonomy.dailyRuns).toBe(0);
    expect(saved.autonomy.research).toBe(false);
  });

  it('a corrupt autonomy value falls back to the default', () => {
    const store = new SettingsStore(dir(), {});
    const saved = store.set({ autonomy: { idleMinutes: 'x' } } as never);
    expect(saved.autonomy.idleMinutes).toBe(30);
    expect(saved.autonomy.enabled).toBe(false);
  });

  it('reads an old file without autonomy fields with defaults', () => {
    const dataDir = dir();
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ provider: 'ollama', model: 'eski' }), 'utf8');
    const settings = new SettingsStore(dataDir, {}).get();
    expect(settings.model).toBe('eski');
    expect(settings.autonomy).toEqual(DEFAULT_SETTINGS.autonomy);
  });

  it('falls back to defaults on a corrupt file', () => {
    const dataDir = dir();
    const store = new SettingsStore(dataDir, {});
    store.set({ model: 'a' });
    const path = join(dataDir, 'settings.json');
    require('node:fs').writeFileSync(path, '{bozuk', 'utf8');
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns secrets masked, writes to disk and deletes on an empty string', () => {
    const dataDir = dir();
    const store = new SettingsStore(dataDir, {});
    store.setSecrets({ anthropic: 'sk-test-123' });
    expect(store.public().secrets.anthropic).toBe(true);
    expect(store.public()).not.toHaveProperty('anthropicKey');
    // the raw key is on disk (no encryption) and absent from the UI.
    expect(readFileSync(join(dataDir, 'secrets.json'), 'utf8')).toContain('sk-test-123');
    store.setSecrets({ anthropic: '' });
    expect(store.public().secrets.anthropic).toBe(false);
  });

  it('the environment variable key is also visible', () => {
    const store = new SettingsStore(dir(), { ANTHROPIC_API_KEY: 'env-key' });
    expect(store.public().envKeys.anthropic).toBe(true);
    expect(store.apiKey('anthropic')).toBe('env-key');
  });

  it('the disk key takes precedence over the environment', () => {
    const store = new SettingsStore(dir(), { ANTHROPIC_API_KEY: 'env-key' });
    store.setSecrets({ anthropic: 'disk-key' });
    expect(store.apiKey('anthropic')).toBe('disk-key');
  });
});

describe('buildProvider', () => {
  it('builds the real adapter when an anthropic key exists', () => {
    const built = buildProvider({ ...DEFAULT_SETTINGS, provider: 'anthropic' }, () => 'k');
    expect(built.provider.name).toBe('anthropic');
  });

  it('falls back to local without a key', () => {
    const built = buildProvider({ ...DEFAULT_SETTINGS, provider: 'anthropic' }, () => undefined);
    expect(built.provider.name).toBe('ollama');
    expect(built.label).toContain('yerel');
  });

  it('custom falls back to local with an empty endpoint', () => {
    const built = buildProvider({ ...DEFAULT_SETTINGS, provider: 'custom', baseUrl: '' }, () => undefined);
    expect(built.provider.name).toBe('ollama');
  });

  it('custom uses the given endpoint', () => {
    const built = buildProvider(
      { ...DEFAULT_SETTINGS, provider: 'custom', baseUrl: 'http://127.0.0.1:8080/v1' },
      () => undefined,
    );
    expect(built.provider.name).toBe('custom');
  });

  it('builds it when an openai key exists', () => {
    const built = buildProvider({ ...DEFAULT_SETTINGS, provider: 'openai' }, () => 'k');
    expect(built.provider.name).toBe('openai');
  });
});
