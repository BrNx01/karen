import type { ChatMessage, Delta, Provider, StopReason, StreamRequest, ToolCall } from '../types.js';
import { parseSSE, responseChunks } from './sse.js';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] };

/** If not finite the field is not sent; if out of range it is clamped to 0..1. */
function clampTemperature(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

export function toAnthropicMessages(messages: ChatMessage[]): { system?: string; messages: AnthropicMessage[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const role: 'user' | 'assistant' = message.role === 'assistant' ? 'assistant' : 'user';
    const blocks: AnthropicBlock[] = [];
    if (message.role === 'tool') {
      blocks.push({ type: 'tool_result', tool_use_id: message.toolCallId ?? '', content: message.content });
    } else {
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args ?? {} });
      }
    }
    if (blocks.length === 0) continue;
    // Anthropic wants roles to alternate: merge consecutive messages of the same role.
    const previous = out[out.length - 1];
    if (previous && previous.role === role) previous.content.push(...blocks);
    else out.push({ role, content: blocks });
  }
  return { system: system || undefined, messages: out };
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *stream(req: StreamRequest): AsyncIterable<Delta> {
    const { system, messages } = toAnthropicMessages(req.messages);
    const temperature = clampTemperature(req.temperature);
    const res = await this.fetchImpl(`${this.opts.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: 4096,
        stream: true,
        ...(temperature === undefined ? {} : { temperature }),
        ...(system ? { system } : {}),
        messages,
        ...(req.tools.length > 0
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
              })),
            }
          : {}),
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: StopReason = 'end';
    let doneSent = false;
    const pending = new Map<number, { id: string; name: string; json: string }>();

    for await (const event of parseSSE(responseChunks(res))) {
      const payload = safeJson(event.data);
      if (!payload) continue;
      const type = String(payload['type'] ?? event.event ?? '');

      if (type === 'message_start') {
        const usage = (payload['message'] as { usage?: { input_tokens?: number } } | undefined)?.usage;
        inputTokens = usage?.input_tokens ?? 0;
      } else if (type === 'content_block_start') {
        const index = Number(payload['index'] ?? 0);
        const block = payload['content_block'] as { type?: string; id?: string; name?: string } | undefined;
        if (block?.type === 'tool_use') {
          pending.set(index, { id: block.id ?? `tool_${index}`, name: block.name ?? '', json: '' });
        }
      } else if (type === 'content_block_delta') {
        const index = Number(payload['index'] ?? 0);
        const delta = payload['delta'] as { type?: string; text?: string; partial_json?: string } | undefined;
        if (delta?.type === 'text_delta' && delta.text) {
          yield { type: 'text', text: delta.text };
        } else if (delta?.type === 'input_json_delta' && delta.partial_json !== undefined) {
          const slot = pending.get(index);
          if (slot) slot.json += delta.partial_json;
        }
      } else if (type === 'message_delta') {
        const delta = payload['delta'] as { stop_reason?: string } | undefined;
        stopReason = mapStop(delta?.stop_reason);
        const usage = payload['usage'] as { output_tokens?: number } | undefined;
        outputTokens = usage?.output_tokens ?? outputTokens;

        for (const slot of pending.values()) {
          yield { type: 'tool_call', call: toCall(slot) };
        }
        pending.clear();
        yield { type: 'usage', inputTokens, outputTokens };
        yield { type: 'done', stopReason };
        doneSent = true;
      } else if (type === 'message_stop' && !doneSent) {
        yield { type: 'done', stopReason };
        doneSent = true;
      }
    }
  }
}

function toCall(slot: { id: string; name: string; json: string }): ToolCall {
  return { id: slot.id, name: slot.name, args: slot.json.trim() ? safeJson(slot.json) ?? {} : {} };
}

function mapStop(reason: string | undefined): StopReason {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  return 'end';
}

export function safeJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
