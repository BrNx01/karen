import type { ChatMessage } from './types.js';

/**
 * Budget: systems are counted as fixed, messages that fit are kept from the queue backwards.
 * Tool results whose parent was dropped are meaningless on their own, so they are cleared from the front.
 */
function keepBudget(systems: ChatMessage[], rest: ChatMessage[], maxChars: number): ChatMessage[] {
  let used = systems.reduce((n, m) => n + m.content.length, 0);
  const kept: ChatMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const message = rest[i];
    if (!message) break;
    if (used + message.content.length > maxChars) break;
    kept.unshift(message);
    used += message.content.length;
  }

  while (kept[0]?.role === 'tool') kept.shift();
  return kept;
}

/**
 * Always keeps system messages, dropping from the oldest until the budget is exceeded.
 * If at least one full turn (2 messages) was dropped, appends a one-line note.
 *
 * shortcut: no LLM summarisation, trimming only — change this when summaries are added on context overflow.
 */
export function trimHistory(messages: ChatMessage[], maxChars = 200_000): ChatMessage[] {
  const systems = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  const kept = keepBudget(systems, rest, maxChars);
  const dropped = rest.length - kept.length;
  const out = [...systems];
  if (dropped >= 2) out.push({ role: 'assistant', content: `[previous ${dropped} messages were trimmed]` });
  return [...out, ...kept];
}

/**
 * Crisis: last 2 user turns and everything after; the error trace is kept, history is dropped.
 * If there are fewer than two turns with a user, there is nothing to trim and the whole history stays.
 */
export function trimCrisis(messages: ChatMessage[], maxChars = 200_000): ChatMessage[] {
  const systems = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  const users: number[] = [];
  for (let i = rest.length - 1; i >= 0 && users.length < 2; i--) {
    if (rest[i]!.role === 'user') users.push(i);
  }
  const tail = rest.slice(users.length < 2 ? 0 : users[1]!);

  const kept = keepBudget(systems, tail, maxChars);
  // The note counts against the total before trimming: the budget also removes from the context.
  const dropped = rest.length - kept.length;
  const out = [...systems];
  if (dropped >= 2) out.push({ role: 'assistant', content: `[crisis mode: previous ${dropped} messages were removed from the context]` });
  return [...out, ...kept];
}
