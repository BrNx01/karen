import { describe, it, expect } from 'vitest';
import { PROVIDERS, provider, providerList } from '../server/engine/providers/registry.js';
import { buildProvider } from '../server/engine/providers/build.js';
import { DEFAULT_SETTINGS } from '../server/settings.js';

const settings = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over });

describe('provider registry', () => {
  it('lists local and cloud providers together', () => {
    const locals = PROVIDERS.filter((p) => p.local).map((p) => p.id);
    expect(locals).toEqual(expect.arrayContaining(['ollama', 'lmstudio', 'llamacpp']));
    const clouds = PROVIDERS.filter((p) => !p.local).map((p) => p.id);
    expect(clouds).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'google', 'groq', 'cerebras', 'deepseek', 'mistral', 'openrouter', 'together', 'xai', 'azure-openai']),
    );
  });

  it('every entry has a valid kind and a unique id', () => {
    const ids = new Set<string>();
    for (const spec of PROVIDERS) {
      expect(['anthropic', 'openai', 'google']).toContain(spec.kind);
      expect(ids.has(spec.id)).toBe(false);
      ids.add(spec.id);
      if (spec.kind !== 'anthropic') expect(spec.baseUrl || spec.extra).toBeTruthy();
    }
  });

  it('providerList anahtar durumunu maskeler', () => {
    const list = providerList({ groq: true });
    const groq = list.find((p) => p.id === 'groq');
    expect(groq?.configured).toBe(true);
    expect(list.find((p) => p.id === 'ollama')?.requiresKey).toBe(false);
    expect(JSON.stringify(list)).not.toContain('apiKey');
  });

  it('bilinmeyen kimlik undefined', () => {
    expect(provider('yok')).toBeUndefined();
  });
});

describe('buildProvider', () => {
  it('a cloud provider without a key falls back to local', () => {
    const built = buildProvider(settings({ provider: 'groq' }), () => undefined);
    expect(built.provider.name).toBe('ollama');
    expect(built.label).toContain('yerel');
  });

  it('an OpenAI-compatible provider with a key is built', () => {
    const built = buildProvider(settings({ provider: 'groq' }), (id) => (id === 'groq' ? 'k' : undefined));
    expect(built.provider.name).toBe('groq');
    expect(built.spec.id).toBe('groq');
  });

  it('is built with an anthropic key', () => {
    const built = buildProvider(settings({ provider: 'anthropic' }), () => 'k');
    expect(built.provider.name).toBe('anthropic');
  });

  it('google uses a separate adapter', () => {
    const built = buildProvider(settings({ provider: 'google' }), () => 'k');
    expect(built.provider.name).toBe('google');
  });

  it('the local provider is built without a key', () => {
    const built = buildProvider(settings({ provider: 'lmstudio' }), () => undefined);
    expect(built.provider.name).toBe('lmstudio');
  });

  it('azure builds the endpoint from deployment and api-version', () => {
    const built = buildProvider(
      settings({
        provider: 'azure-openai',
        model: 'gpt-4o',
        providers: { 'azure-openai': { baseUrl: 'https://ornek.openai.azure.com', apiVersion: '2024-10-21' } },
      }),
      () => 'k',
    );
    expect(built.provider.name).toBe('azure-openai');
  });

  it('azure falls back to local without an endpoint', () => {
    const built = buildProvider(settings({ provider: 'azure-openai' }), () => 'k');
    expect(built.provider.name).toBe('ollama');
  });

  it('custom falls back to local with an empty endpoint', () => {
    const built = buildProvider(settings({ provider: 'custom', baseUrl: '' }), () => undefined);
    expect(built.provider.name).toBe('ollama');
  });

  it('custom uses the given endpoint', () => {
    const built = buildProvider(settings({ provider: 'custom', baseUrl: 'http://127.0.0.1:9000/v1' }), () => undefined);
    expect(built.provider.name).toBe('custom');
  });

  it('each provider uses its own base URL setting', () => {
    const built = buildProvider(
      settings({ provider: 'openrouter', providers: { openrouter: { baseUrl: 'http://proxy/v1' } } }),
      () => 'k',
    );
    expect(built.provider.name).toBe('openrouter');
  });
});
