import type { Approver } from './permissions.js';
import { classify } from './permissions.js';
import { trimCrisis, trimHistory } from './history.js';
import { toolDefs } from './tools/types.js';
import type { Tool, ToolContext } from './tools/types.js';
import type { ChatMessage, Delta, Provider, StopReason, ToolCall } from './types.js';
import type { EventLog } from '../store/events.js';
import { assess, signature, type ReflexVerdict } from '../brain/reflex.js';

export const MAX_TURNS = 25;

export type AgentOptions = {
  provider: Provider;
  model: string;
  tools: Tool[];
  approver: Approver;
  log: EventLog;
  sessionId: string;
  cwd: string;
  system: string;
  /** Sampling temperature; the provider default is used when omitted. */
  temperature?: number;
  maxTurns?: number;
  signal?: AbortSignal;
  onDelta?: (d: Delta) => void;
  /** When false, errors are not written to the log (an autonomous turn must not pollute biological state). */
  logErrors?: boolean;
  /** Crisis: only the last two turns are sent instead of the history. */
  crisis?: boolean;
  /** Called when a reflex intervention happens (the event is already in the event log). */
  onReflex?: (verdict: ReflexVerdict) => void;
};

export type AgentStopReason = 'end' | 'max_turns' | 'aborted' | 'error';

export type AgentResult = {
  messages: ChatMessage[];
  stopReason: AgentStopReason;
  error?: string;
};

export async function runAgent(opts: AgentOptions, messages: ChatMessage[]): Promise<AgentResult> {
  const history: ChatMessage[] = [...messages];
  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  const toolContext: ToolContext = { cwd: opts.cwd, signal: opts.signal ?? new AbortController().signal };
  const tools = toolDefs(opts.tools);
  // The repeat counter lives across turns: the same call can arrive three turns in a row.
  let repeatKey = '';
  let repeats = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (opts.signal?.aborted) return { messages: history, stopReason: 'aborted' };

    let text = '';
    const calls: ToolCall[] = [];
    let stopReason: StopReason | undefined;
    let sawUsage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      for await (const delta of opts.provider.stream({
        model: opts.model,
        messages: [{ role: 'system', content: opts.system }, ...(opts.crisis ? trimCrisis(history) : trimHistory(history))],
        tools,
        signal: opts.signal,
        ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
      })) {
        opts.onDelta?.(delta);
        if (delta.type === 'text') text += delta.text;
        else if (delta.type === 'tool_call') calls.push(delta.call);
        else if (delta.type === 'done') stopReason = delta.stopReason;
        else if (delta.type === 'usage') sawUsage = { inputTokens: delta.inputTokens, outputTokens: delta.outputTokens };
      }
    } catch (err) {
      // Half-finished tool calls are not executed; the session closes with an error.
      if (isAbort(err, opts.signal)) return { messages: history, stopReason: 'aborted' };
      const message = (err as Error).message;
      if (opts.logErrors !== false) opts.log.append('error', 'system', opts.sessionId, { message });
      return { messages: history, stopReason: 'error', error: message };
    }

    // The stream closing without a done event is a disconnect; the half turn is not executed.
    if (stopReason === undefined) {
      const message = 'stream ended without done';
      if (opts.logErrors !== false) opts.log.append('error', 'system', opts.sessionId, { message });
      return { messages: history, stopReason: 'error', error: message };
    }

    opts.log.append('message', 'session', opts.sessionId, {
      role: 'assistant',
      ...(sawUsage ? { usage: sawUsage } : {}),
    }, text);
    history.push({ role: 'assistant', content: text, ...(calls.length > 0 ? { toolCalls: calls } : {}) });

    if (stopReason !== 'tool_use' || calls.length === 0) {
      return { messages: history, stopReason: 'end' };
    }

    const loggedCalls = new Set<string>();
    const answerRest = (from: number, reason: string): void => {
      // If the turn is cut short, a tool_call stays unanswered and the provider rejects the next turn:
      // every call in the batch is answered, the rest are marked as not executed.
      // Only a call that really has a tool_call line in the log is closed.
      for (const rest of calls.slice(from)) {
        if (loggedCalls.has(rest.id)) {
          opts.log.append('tool_result', 'system', opts.sessionId, { tool: rest.name, ok: false }, 'aborted/reflex');
        }
        history.push({ role: 'tool', content: reason, toolCallId: rest.id });
      }
    };

    for (const [i, call] of calls.entries()) {
      if (opts.signal?.aborted) {
        answerRest(i, 'cancelled: the call was not executed');
        return { messages: history, stopReason: 'aborted' };
      }

      const tool = opts.tools.find((t) => t.def.name === call.name);
      if (!tool) {
        history.push({ role: 'tool', content: `unknown tool: ${call.name}`, toolCallId: call.id });
        continue;
      }

      const args = (call.args ?? {}) as Record<string, unknown>;
      const verdict = classify({ tool: call.name, access: tool.access, args, cwd: opts.cwd });
      opts.log.append('tool_call', 'session', opts.sessionId, {
        tool: call.name,
        args,
        className: verdict.class,
        reason: verdict.reason,
      });
      loggedCalls.add(call.id);

      const key = signature(call.name, args);
      repeats = key === repeatKey ? repeats + 1 : 1;
      repeatKey = key;

      // Reflex runs BEFORE approval and execution: the third identical side-effecting call is never asked.
      const reflex = assess({ rssMb: 0, totalMb: 0, repeats, tool: call.name });
      if (reflex.action === 'abort-session') {
        opts.log.append('reflex', 'system', opts.sessionId, {
          action: 'abort-session',
          tool: call.name,
          repeats,
        });
        // If the turn is cut short, a tool_call stays unanswered and the provider rejects the next turn:
        // every call in the batch is answered, the rest are marked as not executed.
        for (const [offset, rest] of calls.slice(i).entries()) {
          opts.log.append('tool_result', 'system', opts.sessionId, { tool: rest.name, ok: false }, 'aborted/reflex');
          history.push({
            role: 'tool',
            content:
              offset === 0
                ? 'reflex: the same call arrived 3 times in a row, session aborted'
                : 'reflex: call not executed',
            toolCallId: rest.id,
          });
        }
        opts.onReflex?.(reflex);
        return { messages: history, stopReason: 'aborted' };
      }

      let allowed: boolean;
      if (verdict.class === 'simple') {
        allowed = true;
        opts.log.append('permission', 'brain', opts.sessionId, {
          tool: call.name,
          decision: 'auto',
          reason: verdict.reason,
        });
      } else {
        allowed = await askWithAbort(opts.approver, { tool: call.name, access: tool.access, args, cwd: opts.cwd }, opts.signal);
        opts.log.append('permission', 'system', opts.sessionId, {
          tool: call.name,
          decision: allowed ? 'approved' : 'denied',
          reason: verdict.reason,
        });
        // If it was cancelled while waiting for approval, nothing is executed.
        if (opts.signal?.aborted) {
          answerRest(i, 'cancelled: the call was not executed');
          return { messages: history, stopReason: 'aborted' };
        }
      }

      if (!allowed) {
        history.push({ role: 'tool', content: 'denied by user', toolCallId: call.id });
        continue;
      }

      let result;
      try {
        result = await tool.run(args, toolContext);
      } catch (err) {
        // An error thrown inside a tool (including cancellation) does not lock the session.
        if (isAbort(err, opts.signal)) {
          // The call in flight is logged separately; the rest are closed by `answerRest`.
          opts.log.append('tool_result', 'system', opts.sessionId, { tool: call.name, ok: false }, 'aborted/reflex');
          history.push({ role: 'tool', content: 'cancelled: the call was not executed', toolCallId: call.id });
          answerRest(i + 1, 'cancelled: the call was not executed');
          return { messages: history, stopReason: 'aborted' };
        }
        const message = `tool failed: ${(err as Error).message}`;
        opts.log.append('tool_result', 'system', opts.sessionId, { tool: call.name, ok: false }, message);
        history.push({ role: 'tool', content: message, toolCallId: call.id });
        continue;
      }
      opts.log.append(
        'tool_result',
        'system',
        opts.sessionId,
        {
          tool: call.name,
          ok: result.ok,
          // Command only: all args (write_file content) would bloat the log.
          ...(typeof args['command'] === 'string' ? { command: args['command'].slice(0, 500) } : {}),
        },
        result.output,
      );
      history.push({ role: 'tool', content: result.output, toolCallId: call.id });
    }
  }

  return { messages: history, stopReason: 'max_turns' };
}

/** CANCELLATION WHILE WAITING FOR APPROVAL: if ask stays pending, the cancel signal counts as a rejection. */
async function askWithAbort(
  approver: Approver,
  req: Parameters<Approver['ask']>[0],
  signal?: AbortSignal,
): Promise<boolean> {
  if (!signal) return approver.ask(req).catch(() => false);
  if (signal.aborted) return false;

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<boolean>((resolve) => {
    onAbort = () => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([approver.ask(req).catch(() => false), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError' || signal?.aborted === true;
}
