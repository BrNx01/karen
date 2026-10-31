import { buildApiUrl } from './url.js';
import type { Locale } from '../../shared/i18n/index.js';

export type ServerMsg =
  | { type: 'delta'; sessionId: string; delta: { type: string; text?: string } }
  | { type: 'status'; sessionId: string; status: string }
  | { type: 'done'; sessionId: string; stopReason: string }
  | { type: 'error'; sessionId?: string; message: string }
  | { type: 'history'; sessionId: string; messages: { role: string; content: string }[] }
  | {
      type: 'approval_request';
      sessionId: string;
      requestId: string;
      tool: string;
      args: Record<string, unknown>;
      reason: string;
    }
  | { type: 'notice'; sessionId: string; text: string };

export const token = new URLSearchParams(location.search).get('token') ?? '';

/**
 * Active interface language, mirrored onto every request so the server can localise
 * the messages it generates at runtime. Stored text is never translated.
 */
let currentLocale: Locale = 'en';

export function setRequestLocale(locale: Locale): void {
  currentLocale = locale;
}

function withToken(path: string): string {
  return buildApiUrl(path, token);
}

function localeHeader(): Record<string, string> {
  return { 'x-karen-locale': currentLocale };
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(withToken(path), { headers: localeHeader() });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(withToken(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...localeHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

export async function deleteJson(path: string): Promise<void> {
  const res = await fetch(withToken(path), { method: 'DELETE', headers: localeHeader() });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(withToken(path), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...localeHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

/** Full URL with token, for external callers. */
export function buildUrl(path: string): string {
  return withToken(path);
}

export function openSocket(onMessage: (msg: ServerMsg) => void): WebSocket {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);
  socket.addEventListener('message', (event) => {
    try {
      onMessage(JSON.parse(event.data as string) as ServerMsg);
    } catch {
      // A malformed message must not drop the connection.
    }
  });
  return socket;
}
