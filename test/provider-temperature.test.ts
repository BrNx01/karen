import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../server/engine/providers/openai-compatible.js';
import { AnthropicProvider } from '../server/engine/providers/anthropic.js';
import { GoogleProvider } from '../server/engine/providers/google.js';

function capture() {
  let body = '';
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    body = String(init?.body ?? '');
    return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, body: () => body };
}

const messages = [{ role: 'user' as const, content: 'selam' }];

async function drain(iter: AsyncIterable<unknown>) {
  for await (const _ of iter) void _;
}

describe('temperature passing', () => {
  it('writes temperature into an openai-compatible body', async () => {
    const c = capture();
    const p = new OpenAICompatibleProvider({ name: 'x', baseUrl: 'http://x/v1', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [], temperature: 0.25 }));
    expect(JSON.parse(c.body()).temperature).toBe(0.25);
  });

  it('sends no field for openai-compatible undefined', async () => {
    const c = capture();
    const p = new OpenAICompatibleProvider({ name: 'x', baseUrl: 'http://x/v1', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [] }));
    expect('temperature' in JSON.parse(c.body())).toBe(false);
  });

  it('writes temperature into the anthropic body', async () => {
    const c = capture();
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [], temperature: 0.9 }));
    expect(JSON.parse(c.body()).temperature).toBe(0.9);
  });

  it('writes temperature into google generationConfig', async () => {
    const c = capture();
    const p = new GoogleProvider({ apiKey: 'k', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [], temperature: 0.4 }));
    expect(JSON.parse(c.body()).generationConfig.temperature).toBe(0.4);
  });

  it('an invalid temperature is clamped', async () => {
    const c = capture();
    const p = new OpenAICompatibleProvider({ name: 'x', baseUrl: 'http://x/v1', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [], temperature: 5 }));
    expect(JSON.parse(c.body()).temperature).toBeLessThanOrEqual(1);
  });

  it('sends no field for anthropic undefined', async () => {
    const c = capture();
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [] }));
    expect('temperature' in JSON.parse(c.body())).toBe(false);
  });

  it('sends no field for google undefined', async () => {
    const c = capture();
    const p = new GoogleProvider({ apiKey: 'k', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [] }));
    expect('temperature' in JSON.parse(c.body()).generationConfig).toBe(false);
  });

  it('a non-finite temperature is not sent', async () => {
    const c = capture();
    const p = new OpenAICompatibleProvider({ name: 'x', baseUrl: 'http://x/v1', fetchImpl: c.fetchImpl });
    await drain(p.stream({ model: 'm', messages, tools: [], temperature: Number.NaN }));
    expect('temperature' in JSON.parse(c.body())).toBe(false);
  });
});
