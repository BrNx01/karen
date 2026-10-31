import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AnthropicProvider, toAnthropicMessages } from '../../server/engine/providers/anthropic.js';
import { OpenAICompatibleProvider } from '../../server/engine/providers/openai-compatible.js';
import { createProvider } from '../../server/engine/providers/index.js';
import type { Delta, Provider, StreamRequest } from '../../server/engine/types.js';

const body = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const fakeFetch = (text: string): typeof fetch =>
  (async () =>
    new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;

const collect = async (p: Provider, req?: Partial<StreamRequest>): Promise<Delta[]> => {
  const out: Delta[] = [];
  for await (const d of p.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [], ...req })) {
    out.push(d);
  }
  return out;
};

describe('anthropic adapter', () => {
  it('translates text, tool calls and usage', async () => {
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl: fakeFetch(body('anthropic-stream.txt')) });
    const out = await collect(p);
    expect(out[0]).toEqual({ type: 'text', text: 'Merhaba' });
    expect(out.find((d) => d.type === 'tool_call')).toEqual({
      type: 'tool_call',
      call: { id: 'tu_1', name: 'read_file', args: { path: 'a.txt' } },
    });
    expect(out.find((d) => d.type === 'usage')).toEqual({ type: 'usage', inputTokens: 12, outputTokens: 7 });
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });
});

describe('openai-compatible adapter', () => {
  it('concatenates tool call arguments', async () => {
    const p = new OpenAICompatibleProvider({ baseUrl: 'http://local/v1', fetchImpl: fakeFetch(body('openai-stream.txt')) });
    const out = await collect(p);
    expect(out.find((d) => d.type === 'tool_call')).toEqual({
      type: 'tool_call',
      call: { id: 'call_1', name: 'read_file', args: { path: 'a.txt' } },
    });
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });
});

describe('truncated stream', () => {
  it('emits no done without a finish event', async () => {
    const truncated = body('openai-stream.txt')
      .split('\n\n')
      .filter((block) => !block.includes('finish_reason'))
      .filter((block) => block.trim().length > 0)
      .join('\n\n');
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://local/v1',
      fetchImpl: fakeFetch(truncated),
    });
    const out = await collect(p);
    expect(out.some((d) => d.type === 'done')).toBe(false);
  });
});

describe('anthropic message merging', () => {
  it('alternates roles across parallel tool calls', () => {
    const merged = toAnthropicMessages([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 'x', args: {} },
          { id: 'b', name: 'y', args: {} },
        ],
      },
      { role: 'tool', content: 'r1', toolCallId: 'a' },
      { role: 'tool', content: 'r2', toolCallId: 'b' },
    ]);
    expect(merged.messages.map((m) => m.role)).toEqual(['assistant', 'user']);
    expect(merged.messages[1]?.content).toHaveLength(2);
  });
});

describe('createProvider', () => {  it('throws a clear error when the key is missing', () => {
    expect(() => createProvider('anthropic', {})).toThrow('missing API key: ANTHROPIC_API_KEY');
  });
  it('the local provider is built without a key', () => {
    expect(createProvider('ollama', {}).name).toBe('ollama');
  });
});
