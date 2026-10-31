export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ToolCall = { id: string; name: string; args: unknown };

export type ChatMessage = {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type StopReason = 'end' | 'tool_use' | 'max_tokens';

export type Delta =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: StopReason };

export type StreamRequest = {
  model: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  /** 0..1 — comes from the state vector; the provider default is used when omitted. */
  temperature?: number;
  signal?: AbortSignal;
};

export type Provider = {
  name: string;
  stream(req: StreamRequest): AsyncIterable<Delta>;
};
