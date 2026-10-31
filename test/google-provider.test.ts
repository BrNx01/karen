import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GoogleProvider, toGeminiContents } from '../server/engine/providers/google.js';
import type { Delta } from '../server/engine/types.js';

const body = () => readFileSync(new URL('./fixtures/google-stream.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fakeFetch = (text: string): typeof fetch =>
  (async () => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;

async function collect(text: string): Promise<Delta[]> {
  const provider = new GoogleProvider({ apiKey: 'k', fetchImpl: fakeFetch(text) });
  const out: Delta[] = [];
  for await (const delta of provider.stream({
    model: 'gemini-2.0-flash',
    messages: [{ role: 'user', content: 'selam' }],
    tools: [],
  })) {
    out.push(delta);
  }
  return out;
}

describe('google adapter', () => {
  it('translates text, tool calls and usage', async () => {
    const out = await collect(body());
    expect(out[0]).toEqual({ type: 'text', text: 'Merhaba' });
    expect(out.find((d) => d.type === 'tool_call')).toMatchObject({
      type: 'tool_call',
      call: { name: 'read_file', args: { path: 'a.txt' } },
    });
    expect(out.find((d) => d.type === 'usage')).toEqual({ type: 'usage', inputTokens: 11, outputTokens: 5 });
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('emits no done without a finish event', async () => {
    const truncated = body().split('\n\n')[0] ?? '';
    const out = await collect(truncated);
    expect(out.some((d) => d.type === 'done')).toBe(false);
  });

  it('converts messages to Gemini format and alternates roles', () => {
    const { system, contents } = toGeminiContents([
      { role: 'system', content: 'SEN KAREN' },
      { role: 'user', content: 'selam' },
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
    expect(system).toBe('SEN KAREN');
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[2]?.parts).toHaveLength(2);
  });

  it('strips unsupported fields from the schema', async () => {
    const provider = new GoogleProvider({ apiKey: 'k', fetchImpl: fakeFetch('') });
    let sent = '';
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sent = String(init?.body ?? '');
      return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const p = new GoogleProvider({ apiKey: 'k', fetchImpl });
    for await (const _ of p.stream({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          name: 't',
          description: 'd',
          inputSchema: { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } },
        },
      ],
    })) {
      void _;
    }
    expect(sent).not.toContain('additionalProperties');
    expect(sent).toContain('functionDeclarations');
    void provider;
  });
});
