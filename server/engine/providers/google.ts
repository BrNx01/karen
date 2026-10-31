import type { ChatMessage, Delta, Provider, StopReason, StreamRequest, ToolCall } from '../types.js';
import { parseSSE, responseChunks } from './sse.js';
import { safeJson } from './anthropic.js';

type GeminiPart = Record<string, unknown>;

/** If not finite the field is not sent; if out of range it is clamped to 0..1. */
function clampTemperature(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

/**
 * Google Gemini adapter (`generateContent`, streaming). Separate because its protocol
 * differs from OpenAI: `contents[].parts[]`, `functionCall`, `functionResponse`.
 */
export class GoogleProvider implements Provider {
  readonly name = 'google';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *stream(req: StreamRequest): AsyncIterable<Delta> {
    const baseUrl = this.opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const { system, contents } = toGeminiContents(req.messages);
    const temperature = clampTemperature(req.temperature);
    const url = `${baseUrl}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.opts.apiKey)}`;

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(req.tools.length > 0
          ? {
              tools: [
                {
                  functionDeclarations: req.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: stripUnsupported(tool.inputSchema),
                  })),
                },
              ],
            }
          : {}),
        generationConfig: {
          maxOutputTokens: 4096,
          ...(temperature === undefined ? {} : { temperature }),
        },
      }),
      signal: req.signal,
    });

    if (!res.ok) throw new Error(`google ${res.status}: ${(await res.text()).slice(0, 500)}`);

    let stopReason: StopReason = 'end';
    let doneSent = false;
    let inputTokens = 0;
    let outputTokens = 0;
    const calls: ToolCall[] = [];

    for await (const event of parseSSE(responseChunks(res))) {
      const payload = safeJson(event.data);
      if (!payload) continue;

      const usage = payload['usageMetadata'] as
        | { promptTokenCount?: number; candidatesTokenCount?: number }
        | undefined;
      if (usage) {
        inputTokens = usage.promptTokenCount ?? inputTokens;
        outputTokens = usage.candidatesTokenCount ?? outputTokens;
      }

      const candidate = (payload['candidates'] as Record<string, unknown>[] | undefined)?.[0];
      if (!candidate) continue;
      const parts = ((candidate['content'] as Record<string, unknown> | undefined)?.['parts'] ?? []) as GeminiPart[];

      for (const part of parts) {
        if (typeof part['text'] === 'string' && part['text'] !== '') {
          yield { type: 'text', text: part['text'] };
        }
        const fn = part['functionCall'] as { name?: string; args?: Record<string, unknown> } | undefined;
        if (fn?.name) {
          calls.push({
            id: `gemini_${calls.length}_${Date.now()}`,
            name: fn.name,
            args: fn.args ?? {},
          });
        }
      }

      const finish = candidate['finishReason'];
      if (finish === 'STOP') {
        stopReason = calls.length > 0 ? 'tool_use' : 'end';
      } else if (finish === 'MAX_TOKENS') {
        stopReason = 'max_tokens';
      }

      if (finish && !doneSent) {
        for (const call of calls) yield { type: 'tool_call', call };
        calls.length = 0;
        if (inputTokens > 0 || outputTokens > 0) yield { type: 'usage', inputTokens, outputTokens };
        yield { type: 'done', stopReason };
        doneSent = true;
      }
    }

    if (!doneSent) {
      // A stream without a finish event is truncated: the loop falls into an error.
      return;
    }
  }
}

export function toGeminiContents(messages: ChatMessage[]): {
  system?: string;
  contents: { role: 'user' | 'model'; parts: GeminiPart[] }[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const role: 'user' | 'model' = message.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];

    if (message.role === 'tool') {
      parts.push({
        functionResponse: {
          name: message.toolCallId ?? 'tool',
          response: { result: message.content },
        },
      });
    } else {
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.args ?? {} } });
      }
    }
    if (parts.length === 0) continue;

    // Gemini wants roles to alternate: merge consecutive messages of the same role.
    const previous = contents[contents.length - 1];
    if (previous && previous.role === role) previous.parts.push(...parts);
    else contents.push({ role, parts });
  }
  return { system: system || undefined, contents };
}

/** Gemini does not accept fields like `additionalProperties` in the schema. */
function stripUnsupported(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' || key === '$schema') continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = stripUnsupported(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? stripUnsupported(item as Record<string, unknown>)
          : item,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}
