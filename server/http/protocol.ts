import type { ChatMessage } from '../engine/types.js';
import type { ApprovalRequestMsg } from './approvals.js';
import type { ServerEvent } from '../sessions.js';

export type ClientMsg =
  | { type: 'message'; sessionId: string; text: string }
  | { type: 'approval'; sessionId: string; requestId: string; allow: boolean }
  | { type: 'abort'; sessionId: string }
  | { type: 'open'; sessionId: string };

export type HistoryMsg = { type: 'history'; sessionId: string; messages: ChatMessage[] };
export type ErrorMsg = { type: 'error'; sessionId?: string; message: string };

export type ServerMsg = ServerEvent | ApprovalRequestMsg | HistoryMsg | ErrorMsg;

export function parseClientMsg(raw: string): ClientMsg | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const msg = value as Record<string, unknown>;
  const type = msg['type'];
  if (type === 'message' && typeof msg['sessionId'] === 'string' && typeof msg['text'] === 'string') {
    return { type, sessionId: msg['sessionId'], text: msg['text'] };
  }
  if (
    type === 'approval' &&
    typeof msg['sessionId'] === 'string' &&
    typeof msg['requestId'] === 'string' &&
    typeof msg['allow'] === 'boolean'
  ) {
    return { type, sessionId: msg['sessionId'], requestId: msg['requestId'], allow: msg['allow'] };
  }
  if ((type === 'abort' || type === 'open') && typeof msg['sessionId'] === 'string') {
    return { type, sessionId: msg['sessionId'] };
  }
  return null;
}
