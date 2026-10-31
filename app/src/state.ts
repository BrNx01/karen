import type { Delta } from '../../server/engine/types.js';
import type { SessionInfo } from '../../server/sessions.js';

export type Message = { id: string; role: 'user' | 'assistant' | 'tool'; text: string };

export type PendingApproval = {
  sessionId: string;
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
};

export type AppState = {
  sessions: SessionInfo[];
  activeId: string | null;
  messages: Message[];
  streaming: boolean;
  approvals: PendingApproval[];
  error: string | null;
  notice: string | null;
  connected: boolean;
};

export type Action =
  | { type: 'connected'; connected: boolean }
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'select'; sessionId: string }
  | { type: 'user'; text: string }
  | { type: 'history'; messages: Message[] }
  | { type: 'delta'; delta: Delta }
  | { type: 'done' }
  | { type: 'approval'; approval: PendingApproval }
  | { type: 'approvals'; approvals: PendingApproval[] }
  | { type: 'clearApproval'; requestId: string }
  | { type: 'notice'; text: string }
  | { type: 'error'; message: string | null };

export const initialState: AppState = {
  sessions: [],
  activeId: null,
  messages: [],
  streaming: false,
  approvals: [],
  error: null,
  notice: null,
  connected: false,
};

let counter = 0;
const nextId = (): string => `m${++counter}`;

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: action.connected };
    case 'sessions':
      return { ...state, sessions: action.sessions };
    case 'select':
      return { ...state, activeId: action.sessionId, messages: [], streaming: false };
    case 'user':
      return {
        ...state,
        streaming: true,
        error: null,
        messages: [...state.messages, { id: nextId(), role: 'user', text: action.text }],
      };
    case 'history':
      return { ...state, messages: action.messages, streaming: false };
    case 'delta': {
      if (action.delta.type === 'usage' || action.delta.type === 'tool_call') return state;
      if (action.delta.type === 'done') return { ...state, streaming: false };
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant') {
        const messages = [...state.messages];
        messages[messages.length - 1] = { ...last, text: last.text + action.delta.text };
        return { ...state, messages };
      }
      return {
        ...state,
        messages: [...state.messages, { id: nextId(), role: 'assistant', text: action.delta.text }],
      };
    }
    case 'done':
      return { ...state, streaming: false };
    case 'approval':
      // If the same request arrives twice, the card must not multiply.
      return state.approvals.some((a) => a.requestId === action.approval.requestId)
        ? state
        : { ...state, approvals: [...state.approvals, action.approval], streaming: false };
    case 'approvals':
      return { ...state, approvals: action.approvals };
    case 'clearApproval':
      return { ...state, approvals: state.approvals.filter((a) => a.requestId !== action.requestId) };
    case 'notice':
      return { ...state, notice: action.text };
    case 'error':
      return { ...state, error: action.message, streaming: false };
    default:
      return state;
  }
}
