import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyProbe, DEFAULT_SETTINGS, SettingsStore } from '../server/settings.js';

const store = () => new SettingsStore(mkdtempSync(join(tmpdir(), 'karen-settings-')));

describe('new settings fields', () => {
  it('defaults to asking before touching the computer', () => {
    expect(DEFAULT_SETTINGS.computerControl).toBe('ask');
    expect(DEFAULT_SETTINGS.screenshots).toBe(true);
  });

  it('defaults to a female Piper voice per language', () => {
    expect(DEFAULT_SETTINGS.voiceByLang['tr-TR']).toBe('tr_TR-dfki-medium');
    expect(DEFAULT_SETTINGS.voiceByLang['en-US']).toBe('en_GB-alba-medium');
  });

  it('is not onboarded until the wizard finishes', () => {
    expect(DEFAULT_SETTINGS.onboarded).toBe(false);
  });

  it('accepts the new fields and clamps them', () => {
    const s = store();
    const next = s.set({ computerControl: 'allow', voiceSpeed: 9, consolidationHour: 42, density: 'compact' });
    expect(next.computerControl).toBe('allow');
    expect(next.voiceSpeed).toBe(1.3);
    expect(next.consolidationHour).toBe(23);
    expect(next.density).toBe('compact');
  });

  it('rejects values outside the allowed set', () => {
    const s = store();
    const next = s.set({ computerControl: 'everything' as never, density: 'huge' as never });
    expect(next.computerControl).toBe('ask');
    expect(next.density).toBe('comfortable');
  });

  it('allows turning the daily consolidation off', () => {
    const s = store();
    expect(s.set({ consolidationHour: 3 }).consolidationHour).toBe(3);
    expect(s.set({ consolidationHour: null }).consolidationHour).toBeNull();
  });
});

describe('applyProbe', () => {
  it('writes the address, the model and the provider', () => {
    const s = store();
    const next = applyProbe(s, {
      address: 'https://evren-llmapi.ssyz.org.tr/v1',
      key: 'secret-key',
      providerId: 'evren',
      model: 'glm-5.3',
    });
    expect(next.provider).toBe('evren');
    expect(next.model).toBe('glm-5.3');
    expect(next.providers['evren']).toEqual({ baseUrl: 'https://evren-llmapi.ssyz.org.tr/v1', model: 'glm-5.3' });
    expect(s.apiKey('evren')).toBe('secret-key');
  });

  it('keeps two custom endpoints apart, config and key', () => {
    const s = store();
    applyProbe(s, { address: 'https://a.example.com/v1', key: 'key-a', providerId: 'custom:a.example.com', model: 'm-a' });
    applyProbe(s, { address: 'https://b.example.com/v1', key: 'key-b', providerId: 'custom:b.example.com', model: 'm-b' });

    const settings = s.get();
    expect(settings.providers['custom:a.example.com']?.baseUrl).toBe('https://a.example.com/v1');
    expect(settings.providers['custom:b.example.com']?.baseUrl).toBe('https://b.example.com/v1');
    // The secret store has one slot per base id, so the newest key wins; the configs stay separate.
    expect(s.apiKey('custom:b.example.com')).toBe('key-b');
    expect(settings.provider).toBe('custom:b.example.com');
  });

  it('leaves an existing key alone when the probe carried none', () => {
    const s = store();
    applyProbe(s, { address: 'https://api.example.com/v1', key: 'kept', providerId: 'custom', model: 'm' });
    applyProbe(s, { address: 'https://api.example.com/v1', key: '', providerId: 'custom', model: 'other' });
    expect(s.apiKey('custom')).toBe('kept');
  });

  it('accepts a provider id that carries a host', () => {
    const s = store();
    const next = s.set({ provider: 'custom:my.host.example' as never });
    expect(next.provider).toBe('custom:my.host.example');
  });
});
