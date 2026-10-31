import type { ChatMessage, Delta, Provider, StopReason, StreamRequest, ToolCall } from '../types.js';
import { safeJson } from './anthropic.js';
import { parseSSE, responseChunks } from './sse.js';

type OpenAIMessage = Record<string, unknown>;

/** If not finite the field is not sent; if out of range it is clamped to 0..1. */
function clampTemperature(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

export function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

export class OpenAICompatibleProvider implements Provider {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: { name?: string; baseUrl: string; apiKey?: string; fetchImpl?: typeof fetch },
  ) {
    this.name = opts.name ?? 'openai-compatible';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *stream(req: StreamRequest): AsyncIterable<Delta> {
    const temperature = clampTemperature(req.temperature);
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: req.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: toOpenAIMessages(req.messages),
        ...(temperature === undefined ? {} : { temperature }),
        ...(req.tools.length > 0
          ? {
              tools: req.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
            }
          : {}),
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`${this.name} ${res.status}: ${(await res.text()).slice(0, 500)}`);

    let stopReason: StopReason = 'end';
    let doneSent = false;
    const pending = new Map<number, { id: string; name: string; json: string }>();

    for await (const event of parseSSE(responseChunks(res))) {
      if (event.data === '[DONE]') continue;
      const payload = safeJson(event.data);
      if (!payload) continue;

      const usage = payload['usage'] as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (usage) {
        yield { type: 'usage', inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 };
      }

      const choice = (payload['choices'] as Record<string, unknown>[] | undefined)?.[0];
      if (!choice) continue;
      const delta = choice['delta'] as Record<string, unknown> | undefined;

      if (typeof delta?.['content'] === 'string' && delta['content']) {
        yield { type: 'text', text: delta['content'] };
      }

      const toolCalls = delta?.['tool_calls'] as
        | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        | undefined;
      for (const item of toolCalls ?? []) {
        const index = item.index ?? 0;
        const slot = pending.get(index) ?? { id: item.id ?? `call_${index}`, name: '', json: '' };
        if (item.id) slot.id = item.id;
        if (item.function?.name) slot.name = item.function.name;
        if (item.function?.arguments) slot.json += item.function.arguments;
        pending.set(index, slot);
      }

      const finish = choice['finish_reason'];
      if (finish === 'tool_calls' || finish === 'function_call') stopReason = 'tool_use';
      else if (finish === 'length') stopReason = 'max_tokens';
      else if (finish === 'stop') stopReason = 'end';

      if (finish) {
        yield* flush(pending);
        yield { type: 'done', stopReason };
        doneSent = true;
      }
    }
    // A stream without a finish event is truncated: done is not emitted, the loop falls into an error.
  }
}

function* flush(pending: Map<number, { id: string; name: string; json: string }>): Iterable<Delta> {
  for (const slot of pending.values()) {
    const call: ToolCall = {
      id: slot.id,
      name: slot.name,
      args: slot.json.trim() ? safeJson(slot.json) ?? {} : {},
    };
    yield { type: 'tool_call', call };
  }
  pending.clear();
}
