import { describe, it, expect } from 'vitest';
import {
  inferKind,
  normaliseAddress,
  parseModelList,
  probeProvider,
  providerIdFor,
  secretIdFor,
} from '../server/engine/providers/probe.js';
import { provider } from '../server/engine/providers/registry.js';

const jsonFetch = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

describe('normaliseAddress', () => {
  it('adds a scheme and strips trailing slashes', () => {
    expect(normaliseAddress('api.openai.com/v1')).toBe('https://api.openai.com/v1');
    expect(normaliseAddress(' https://api.openai.com/v1/ ')).toBe('https://api.openai.com/v1');
  });

  it('assumes http only for local addresses', () => {
    expect(normaliseAddress('127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
    expect(normaliseAddress('localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(normaliseAddress('my-box.local/v1')).toBe('http://my-box.local/v1');
    expect(normaliseAddress('example.com/v1')).toBe('https://example.com/v1');
  });

  it('is empty for an empty input', () => {
    expect(normaliseAddress('   ')).toBe('');
  });
});

describe('inferKind', () => {
  it('recognises the two non-OpenAI protocols', () => {
    expect(inferKind('https://api.anthropic.com/v1')).toBe('anthropic');
    expect(inferKind('https://generativelanguage.googleapis.com/v1beta')).toBe('google');
    expect(inferKind('https://evren-llmapi.ssyz.org.tr/v1')).toBe('openai');
  });
});

describe('providerIdFor', () => {
  it('reuses a known preset by host', () => {
    expect(providerIdFor('https://api.openai.com/v1')).toBe('openai');
    expect(providerIdFor('evren-llmapi.ssyz.org.tr/v1')).toBe('evren');
    expect(providerIdFor('http://127.0.0.1:11434/v1')).toBe('ollama');
  });

  it('gives each unknown host its own id, so two custom endpoints never collide', () => {
    expect(providerIdFor('https://a.example.com/v1')).toBe('custom:a.example.com');
    expect(providerIdFor('https://b.example.com/v1')).toBe('custom:b.example.com');
    expect(secretIdFor('custom:a.example.com')).toBe('custom');
  });
});

describe('parseModelList', () => {
  it('reads the OpenAI shape and its context field', () => {
    expect(parseModelList('openai', { data: [{ id: 'gpt-4o', context_length: 128000 }] })).toEqual([
      { id: 'gpt-4o', context: 128000 },
    ]);
  });

  it('reads the alternative context fields', () => {
    expect(parseModelList('openai', { data: [{ id: 'a', context_window: 32000 }] })).toEqual([{ id: 'a', context: 32000 }]);
    expect(parseModelList('openai', { data: [{ id: 'b', top_provider: { context_length: 8000 } }] })).toEqual([
      { id: 'b', context: 8000 },
    ]);
  });

  it('strips the Google models/ prefix', () => {
    expect(parseModelList('google', { models: [{ name: 'models/gemini-2.0-flash', inputTokenLimit: 1000000 }] })).toEqual([
      { id: 'gemini-2.0-flash', context: 1000000 },
    ]);
  });

  it('returns an empty list for a shape it does not know', () => {
    expect(parseModelList('openai', { nope: true })).toEqual([]);
    expect(parseModelList('openai', '<html>')).toEqual([]);
    expect(parseModelList('openai', null)).toEqual([]);
  });

  it('reports a model without a context window', () => {
    expect(parseModelList('openai', { data: [{ id: 'x' }] })).toEqual([{ id: 'x' }]);
  });
});

describe('probeProvider', () => {
  it('returns the provider, its kind and its models', async () => {
    const result = await probeProvider({
      address: 'https://evren-llmapi.ssyz.org.tr/v1',
      key: 'k',
      fetchImpl: jsonFetch({ data: [{ id: 'glm-5.3', context_length: 524288 }] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerId).toBe('evren');
    expect(result.kind).toBe('openai');
    expect(result.models[0]).toEqual({ id: 'glm-5.3', context: 524288 });
  });

  it('turns an HTML body into a readable error, not an empty list', async () => {
    const result = await probeProvider({
      address: 'https://example.com/v1',
      fetchImpl: (async () => new Response('<html>hi</html>', { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not JSON');
  });

  it('surfaces the provider error message', async () => {
    const result = await probeProvider({
      address: 'https://api.example.com/v1',
      key: 'bad',
      fetchImpl: jsonFetch({ error: { message: 'invalid api key' } }, 401),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('401');
    expect(result.error).toContain('invalid api key');
  });

  it('says so when the key sees no models', async () => {
    const result = await probeProvider({ address: 'https://api.example.com/v1', fetchImpl: jsonFetch({ data: [] }) });
    expect(result.ok).toBe(false);
  });

  it('reports an unreachable host without throwing', async () => {
    const result = await probeProvider({
      address: 'https://nope.invalid/v1',
      fetchImpl: (async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('could not reach');
  });

  it('rejects an empty address', async () => {
    expect(await probeProvider({ address: '  ' })).toEqual({ ok: false, error: 'address is empty' });
  });
});

describe('EVREN preset', () => {
  it('is a first-class provider with its own address and env key', () => {
    const spec = provider('evren');
    expect(spec?.label).toContain('EVREN');
    expect(spec?.baseUrl).toBe('https://evren-llmapi.ssyz.org.tr/v1');
    expect(spec?.apiKeyEnv).toBe('EVREN_API_KEY');
  });
});
