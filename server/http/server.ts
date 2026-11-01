import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SessionManager } from '../sessions.js';
import type { RepoStore } from '../repos.js';
import type { SkillStore } from '../skills.js';
import type { MemoryStore } from '../memory/notes.js';
import { strength } from '../memory/notes.js';
import { buildMap } from '../memory/map.js';
import type { WorldModel } from '../memory/world.js';
import type { StateVector } from '../brain/state.js';
import type { DashboardData } from '../dashboard.js';
import type { InboxItem } from '../autonomy/inbox.js';
import { errorBody, requestLocale } from './locale.js';
import { probeProvider } from '../engine/providers/probe.js';
import type { Locale } from '../../shared/i18n/index.js';
import type { VoiceInfo } from '../voice/index.js';
import type { PublicSettings, Settings } from '../settings.js';
import type { ApprovalBroker } from './approvals.js';
import { parseClientMsg, type ServerMsg } from './protocol.js';

/** Shared channel that carries session events and approval requests to connected clients. */
export type EventHub = { send(message: ServerMsg): void };

export type KarenServerOptions = {
  repos: RepoStore;
  sessions: SessionManager;
  approvals: ApprovalBroker;
  hub: EventHub;
  token: string;
  skills?: SkillStore;
  memory?: MemoryStore;
  world?: WorldModel;
  dashboard?: () => DashboardData;
  state?: {
    current: () => StateVector;
    history: (limit?: number) => StateVector[];
    temperature: () => number;
  };
  voice?: {
    status: () => Promise<VoiceInfo>;
    transcribe: (audio: Buffer) => Promise<{ ok: boolean; text?: string; reason?: string }>;
    speak: (text: string) => Promise<{ ok: boolean; reason?: string }>;
    /** Offline neural speech; 503 with a reason when the engine is not installed. */
    audio: (input: { text: string; lang: 'tr-TR' | 'en-US' }) => Promise<{ ok: true; wav: Buffer } | { ok: false; reason: string }>;
  };
  settings?: {
    get: () => PublicSettings;
    patch: (patch: Partial<Settings>) => PublicSettings;
    secrets: (patch: Record<string, unknown>) => PublicSettings;
    providerInfo: () => { label: string; active: string; model: string; fellBack?: boolean; requested?: string };
  };
  probeProvider?: () => Promise<{ ok: boolean; label?: string; ms?: number; reason?: string }>;
  growth?: {
    list: () => unknown[];
    apply: (id: string) => Promise<{ ok: boolean; error?: string }>;
    revert: (id: string) => Promise<{ ok: boolean; error?: string }>;
    reject: (id: string) => boolean;
    codeEditsEnabled: boolean;
  };
  runSleep?: () => Promise<unknown>;
  inbox?: {
    list: (o?: { unreadOnly?: boolean; limit?: number }) => InboxItem[];
    markRead: (id: number) => boolean;
    unreadCount: () => number;
  };
  /** Called only for requests that count as user activity; GET polling does not count. */
  onActivity?: () => void;
  /**
   * Fallback interface locale when a request carries no `x-karen-locale` header.
   * Only live server text is localised; stored data is returned verbatim.
   */
  settingsLocale?: () => Locale;
  rootDir?: string;
  allowedOrigin?: string;
};

export type KarenServer = {
  listen(port?: number): Promise<{ port: number; url: string; token: string }>;
  close(): Promise<void>;
  port(): number | null;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown>> {
  const buf = await readRaw(req, limit);
  if (buf.length === 0) return {};
  const parsed = JSON.parse(buf.toString('utf8')) as unknown;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

async function readRaw(req: IncomingMessage, limit = 25_000_000): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function createKarenServer(opts: KarenServerOptions): KarenServer {
  const clients = new Set<WebSocket>();
  let boundPort: number | null = null;

  opts.hub.send = (message: ServerMsg): void => {
    const text = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === 1) client.send(text);
    }
  };

  const http = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      const message = (err as Error).message;
      const status = /invalid json|body too large/.test(message) ? 400 : 500;
      sendJson(res, status, { error: message });
    });
  });

  const originAllowed = (origin: string | undefined): boolean =>
    origin === undefined || isAllowedOrigin(origin, opts.allowedOrigin, boundPort);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${boundPort ?? 7331}`);
    if (!originAllowed(req.headers.origin)) {
      sendJson(res, 403, errorBody(opts.settingsLocale?.() ?? 'en', 'server.originNotAllowed'));
      return;
    }
    if (url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const supplied = url.searchParams.get('token') ?? req.headers['x-karen-token'];
      if (supplied !== opts.token) {
        sendJson(res, 401, errorBody(opts.settingsLocale?.() ?? 'en', 'server.unauthorized'));
        return;
      }
      await handleApi(req, res, url);
      return;
    }
    serveStatic(res, url.pathname, opts.rootDir);
  }

  /** The request flows normally even if the activity hook fails; no error is written to the log. */
  function notifyActivity(): void {
    try {
      opts.onActivity?.();
    } catch {
      // swallowed
    }
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split('/').filter(Boolean);
    const locale = requestLocale(req.headers['x-karen-locale'], opts.settingsLocale?.() ?? 'en');

    // GET polling (dashboard/state/growth) must not reset the idle counter.
    // The hook must not bring down a user request (same contract as onSessionStart).
    if (req.method !== 'GET') notifyActivity();

    if (parts[1] === 'inbox') {
      const inbox = opts.inbox;
      if (!inbox) {
        sendJson(res, 404, { error: 'inbox disabled' });
        return;
      }
      if (req.method === 'GET' && parts.length === 2) {
        const unreadOnly = url.searchParams.get('unread') === '1';
        const limit = Number(url.searchParams.get('limit') ?? 100);
        sendJson(res, 200, {
          items: inbox.list({ unreadOnly, ...(Number.isFinite(limit) ? { limit } : {}) }),
          unread: inbox.unreadCount(),
        });
        return;
      }
      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'read') {
        const id = Number(parts[2]);
        const ok = Number.isFinite(id) && inbox.markRead(id);
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : errorBody(locale, 'server.notFound'));
        return;
      }
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    if (parts[1] === 'repos') {
      if (req.method === 'GET' && parts.length === 2) {
        sendJson(res, 200, opts.repos.list());
        return;
      }
      if (req.method === 'POST' && parts.length === 2) {
        const body = await readBody(req);
        if (typeof body['path'] !== 'string' || body['path'].trim() === '') {
          sendJson(res, 400, { error: 'path required' });
          return;
        }
        const repo = opts.repos.add(body['path'], typeof body['name'] === 'string' ? body['name'] : undefined);
        sendJson(res, 201, repo);
        return;
      }
      if (req.method === 'DELETE' && parts.length === 3) {
        const removed = opts.repos.remove(parts[2] ?? '');
        sendJson(res, removed ? 200 : 404, removed ? { ok: true } : errorBody(locale, 'server.notFound'));
        return;
      }
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    if (parts[1] === 'sessions') {
      if (req.method === 'GET' && parts.length === 2) {
        sendJson(res, 200, opts.sessions.list());
        return;
      }
      if (req.method === 'POST' && parts.length === 2) {
        const body = await readBody(req);
        const session = opts.sessions.create({
          ...(typeof body['cwd'] === 'string' ? { cwd: body['cwd'] } : {}),
          ...(typeof body['title'] === 'string' ? { title: body['title'] } : {}),
          ...(body['role'] === 'brain' ? { role: 'brain' as const } : {}),
        });
        sendJson(res, 201, session);
        return;
      }
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    if (parts[1] === 'approvals' && req.method === 'GET') {
      sendJson(res, 200, opts.approvals.pending());
      return;
    }

    if (parts[1] === 'skills') {
      const skills = opts.skills;
      if (!skills) {
        sendJson(res, 404, { error: 'skills disabled' });
        return;
      }
      if (req.method === 'GET' && parts.length === 2) {
        sendJson(res, 200, skills.list());
        return;
      }
      if (req.method === 'POST' && parts.length === 2) {
        const body = await readBody(req);
        try {
          const installed =
            typeof body['git'] === 'string' && body['git'].trim() !== ''
              ? await skills.installFromGit(body['git'].trim())
              : typeof body['path'] === 'string' && body['path'].trim() !== ''
                ? skills.install(body['path'].trim())
                : null;
          if (!installed) {
            sendJson(res, 400, { error: 'path or git required' });
            return;
          }
          sendJson(res, 201, installed);
        } catch (err) {
          sendJson(res, 400, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === 'PATCH' && parts.length === 3) {
        const body = await readBody(req);
        if (typeof body['enabled'] !== 'boolean') {
          sendJson(res, 400, { error: 'enabled must be boolean' });
          return;
        }
        const ok = skills.setEnabled(parts[2] ?? '', body['enabled']);
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : errorBody(locale, 'server.notFound'));
        return;
      }
      if (req.method === 'DELETE' && parts.length === 3) {
        const ok = skills.remove(parts[2] ?? '');
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : errorBody(locale, 'server.notFound'));
        return;
      }
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    if (parts[1] === 'dashboard' && req.method === 'GET') {
      if (!opts.dashboard) {
        sendJson(res, 404, { error: 'dashboard disabled' });
        return;
      }
      sendJson(res, 200, opts.dashboard());
      return;
    }

    if (parts[1] === 'state' && req.method === 'GET') {
      const state = opts.state;
      if (!state) {
        sendJson(res, 404, { error: 'state disabled' });
        return;
      }
      sendJson(res, 200, { state: state.current(), temperature: state.temperature(), history: state.history(20) });
      return;
    }

    if (parts[1] === 'world') {
      const world = opts.world;
      if (!world) {
        sendJson(res, 404, { error: 'world disabled' });
        return;
      }
      if (req.method === 'GET' && parts[2] === 'facts') {
        sendJson(
          res,
          200,
          world.facts({
            ...(url.searchParams.get('entity') ? { entity: url.searchParams.get('entity') as string } : {}),
            ...(url.searchParams.get('attribute') ? { attribute: url.searchParams.get('attribute') as string } : {}),
            limit: Number(url.searchParams.get('limit') ?? 50),
          }),
        );
        return;
      }
      if (req.method === 'GET' && parts[2] === 'history') {
        sendJson(res, 200, world.history(Number(url.searchParams.get('limit') ?? 20)));
        return;
      }
      if (req.method === 'POST' && parts[2] === 'compute') {
        const body = await readBody(req);
        const op = String(body['op'] ?? '') as never;
        const attribute = String(body['attribute'] ?? '');
        if (attribute === '') {
          sendJson(res, 400, { error: 'attribute required' });
          return;
        }
        sendJson(res, 200, world.compute(op, attribute, typeof body['entity'] === 'string' ? body['entity'] : undefined));
        return;
      }
      sendJson(res, 404, errorBody(locale, 'server.notFound'));
      return;
    }

    if (parts[1] === 'growth') {
      const growth = opts.growth;
      if (!growth) {
        sendJson(res, 404, { error: 'growth disabled' });
        return;
      }
      if (req.method === 'GET' && parts.length === 2) {
        sendJson(res, 200, { proposals: growth.list(), codeEditsEnabled: growth.codeEditsEnabled });
        return;
      }
      if (req.method === 'POST' && parts.length === 4) {
        const id = parts[2] ?? '';
        const action = parts[3];
        if (action === 'apply') {
          sendJson(res, 200, await growth.apply(id));
          return;
        }
        if (action === 'revert') {
          sendJson(res, 200, await growth.revert(id));
          return;
        }
        if (action === 'reject') {
          sendJson(res, growth.reject(id) ? 200 : 404, { ok: true });
          return;
        }
        sendJson(res, 400, { error: 'unknown action' });
        return;
      }
      sendJson(res, 404, errorBody(locale, 'server.notFound'));
      return;
    }

    if (parts[1] === 'settings') {
      const settings = opts.settings;
      if (!settings) {
        sendJson(res, 404, { error: 'settings disabled' });
        return;
      }
      if (req.method === 'POST' && parts[2] === 'test') {
        if (!opts.probeProvider) {
          sendJson(res, 404, { error: 'probe disabled' });
          return;
        }
        const result = await opts.probeProvider();
        sendJson(res, result.ok ? 200 : 503, result);
        return;
      }
      if (req.method === 'POST' && parts[2] === 'probe') {
        // One address, one key: detects the protocol and lists what that key can use.
        const body = await readBody(req);
        const address = typeof body['address'] === 'string' ? body['address'] : '';
        const key = typeof body['key'] === 'string' ? body['key'] : '';
        if (address.trim() === '') {
          sendJson(res, 400, { error: 'address required' });
          return;
        }
        const result = await probeProvider({ address, key });
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }
      if (req.method === 'GET' && parts.length === 2) {
        sendJson(res, 200, { ...settings.get(), providerInfo: settings.providerInfo() });
        return;
      }
      if (req.method === 'PATCH' && parts.length === 2) {
        const body = await readBody(req);
        sendJson(res, 200, { ...settings.patch(body as Partial<Settings>), providerInfo: settings.providerInfo() });
        return;
      }
      if (req.method === 'POST' && parts[2] === 'secrets') {
        const body = await readBody(req);
        sendJson(res, 200, { ...settings.secrets(body), providerInfo: settings.providerInfo() });
        return;
      }
      sendJson(res, 404, errorBody(locale, 'server.notFound'));
      return;
    }

    if (parts[1] === 'voice') {
      const voice = opts.voice;
      if (!voice) {
        sendJson(res, 404, { error: 'voice disabled' });
        return;
      }
      if (req.method === 'GET' && parts[2] === 'status') {
        sendJson(res, 200, await voice.status());
        return;
      }
      if (req.method === 'POST' && parts[2] === 'transcribe') {
        const audio = await readRaw(req, 25_000_000);
        if (audio.length === 0) {
          sendJson(res, 400, { error: 'audio data is empty' });
          return;
        }
        const result = await voice.transcribe(audio);
        sendJson(res, result.ok ? 200 : 503, result);
        return;
      }
      if (req.method === 'POST' && parts[2] === 'speak') {
        const body = await readBody(req);
        const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
        if (text === '') {
          sendJson(res, 400, { error: 'text required' });
          return;
        }
        const result = await voice.speak(text);
        sendJson(res, result.ok ? 200 : 503, result);
        return;
      }
      if (req.method === 'GET' && parts[2] === 'audio') {
        // The offline neural voice: returns a WAV the renderer plays as-is.
        const text = (url.searchParams.get('text') ?? '').trim();
        const lang = url.searchParams.get('lang') === 'tr-TR' ? 'tr-TR' : 'en-US';
        if (text === '') {
          sendJson(res, 400, { error: 'text required' });
          return;
        }
        const spoken = await voice.audio({ text, lang });
        if (!spoken.ok) {
          sendJson(res, 503, { error: spoken.reason });
          return;
        }
        res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': spoken.wav.length, 'cache-control': 'no-store' });
        res.end(spoken.wav);
        return;
      }
      sendJson(res, 404, errorBody(locale, 'server.notFound'));
      return;
    }

    if (parts[1] === 'map' && req.method === 'GET') {
      const memory = opts.memory;
      if (!memory) {
        sendJson(res, 404, { error: 'memory disabled' });
        return;
      }
      sendJson(res, 200, buildMap(memory));
      return;
    }

    if (parts[1] === 'memory') {
      const memory = opts.memory;
      if (!memory) {
        sendJson(res, 404, { error: 'memory disabled' });
        return;
      }
      if (req.method === 'GET' && parts.length === 3 && parts[2] === 'conflicts') {
        sendJson(res, 200, memory.conflicts());
        return;
      }
      if (req.method === 'GET' && parts.length === 2) {
        const query = url.searchParams.get('q') ?? '';
        const includeDormant = url.searchParams.get('dormant') === '1';
        const includeForgotten = url.searchParams.get('forgotten') === '1';
        if (query.trim() !== '') {
          sendJson(res, 200, memory.recall(query, { limit: 30, includeDormant: true }));
          return;
        }
        sendJson(
          res,
          200,
          memory.list({ includeDormant, includeForgotten }).map((note) => ({ ...note, strength: strength(note) })),
        );
        return;
      }
      if (req.method === 'POST' && parts[2] === 'sleep') {
        if (!opts.runSleep) {
          sendJson(res, 404, { error: 'sleep disabled' });
          return;
        }
        sendJson(res, 200, await opts.runSleep());
        return;
      }
      if (req.method === 'POST' && parts.length === 4) {
        const id = parts[2] ?? '';
        const action = parts[3];
        const body = req.method === 'POST' ? await readBody(req) : {};
        const memoryId = id;
        if (action === 'forget') {
          const ok = memory.forget(memoryId);
          sendJson(res, ok ? 200 : 404, ok ? { ok: true } : errorBody(locale, 'server.notFound'));
          return;
        }
        if (action === 'restore') {
          const ok = memory.restore(memoryId);
          sendJson(res, ok ? 200 : 404, ok ? { ok: true } : errorBody(locale, 'server.notFound'));
          return;
        }
        if (action === 'correct') {
          const text = typeof body['text'] === 'string' ? body['text'] : undefined;
          const ok = memory.correct(memoryId, text, { cortisol: opts.state?.current().cortisol });
          sendJson(res, ok ? 200 : 404, ok ? { ok: true } : errorBody(locale, 'server.notFound'));
          return;
        }
        if (action === 'trauma') {
          // User mark: not a detection but an explicit intent. A note that is already trauma returns 200.
          if (!memory.get(memoryId)) {
            sendJson(res, 404, errorBody(locale, 'server.notFound'));
            return;
          }
          memory.markTrauma(memoryId, 'kullanici');
          sendJson(res, 200, { ok: true });
          return;
        }
        if (action === 'resolve') {
          const otherId = typeof body['otherId'] === 'string' ? body['otherId'] : undefined;
          const ok = memory.resolveConflict(memoryId, otherId);
          sendJson(res, ok ? 200 : 404, ok ? { ok: true } : errorBody(locale, 'server.notFound'));
          return;
        }
        sendJson(res, 400, { error: 'unknown action' });
        return;
      }
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    sendJson(res, 404, errorBody(locale, 'server.notFound'));
  }

  function serveStatic(res: ServerResponse, pathname: string, rootDir?: string): void {
    const dist = resolve(rootDir ?? process.cwd(), 'app', 'dist');
    const index = join(dist, 'index.html');
    if (!existsSync(index)) {
      res.writeHead(200, { 'content-type': MIME['.html'] ?? 'text/plain' });
      res.end('<h1>KAREN server is running</h1><p>The interface is not built (app/dist is missing).</p>');
      return;
    }
    const relative = normalize(pathname).replace(/^[/\\]+/, '');
    let file = join(dist, relative);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = index;
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  }

  const wss = new WebSocketServer({
    noServer: true,
    verifyClient: (info: { origin?: string; req: IncomingMessage }) => {
      const url = new URL(info.req.url ?? '/', 'http://127.0.0.1');
      if (url.searchParams.get('token') !== opts.token) return false;
      return originAllowed(info.origin);
    },
  });

  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (data) => {
      void onClientMessage(ws, data.toString());
    });
  });

  async function onClientMessage(ws: WebSocket, raw: string): Promise<void> {
    const msg = parseClientMsg(raw);
    if (!msg) {
      ws.send(JSON.stringify({ type: 'error', message: 'invalid message' }));
      return;
    }

    if (msg.type === 'approval') {
      // An approval reply is user intent too: it resets the idle counter (spec §8.1).
      notifyActivity();
      // The broker only lets the session that owns the request resolve it.
      if (!opts.approvals.resolve(msg.sessionId, msg.requestId, msg.allow)) {
        ws.send(JSON.stringify({ type: 'error', sessionId: msg.sessionId, message: 'approval not found' }));
      }
      return;
    }

    if (msg.type === 'open') {
      if (!opts.sessions.get(msg.sessionId)) {
        ws.send(JSON.stringify({ type: 'error', sessionId: msg.sessionId, message: 'unknown session' }));
        return;
      }
      ws.send(
        JSON.stringify({
          type: 'history',
          sessionId: msg.sessionId,
          messages: opts.sessions.history(msg.sessionId),
        }),
      );
      return;
    }

    if (msg.type === 'abort') {
      // An abort is user intent too.
      notifyActivity();
      opts.sessions.abort(msg.sessionId);
      opts.approvals.cancelSession(msg.sessionId);
      return;
    }

    // A user message is activity too; that is what separates it from GET polling.
    notifyActivity();
    const result = await opts.sessions.send(msg.sessionId, msg.text);
    if (!result.ok) {
      ws.send(JSON.stringify({ type: 'error', sessionId: msg.sessionId, message: result.error ?? 'error' }));
    }
  }

  return {
    async listen(port = 0) {
      const actualPort = await new Promise<number>((resolvePort, reject) => {
        http.once('error', reject);
        http.listen(port, '127.0.0.1', () => {
          const address = http.address();
          resolvePort(typeof address === 'object' && address ? address.port : port);
        });
      });
      boundPort = actualPort;
      return { port: actualPort, url: `http://127.0.0.1:${actualPort}/?token=${opts.token}`, token: opts.token };
    },
    async close() {
      for (const client of clients) client.close();
      clients.clear();
      await new Promise<void>((resolveClose) => wss.close(() => resolveClose()));
      await new Promise<void>((resolveClose, reject) => http.close((err) => (err ? reject(err) : resolveClose())));
    },
    port() {
      return boundPort;
    },
  };
}

export function isAllowedOrigin(origin: string, allowed: string | undefined, port: number | null): boolean {
  if (allowed && origin === allowed) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return false;
    // Accept the same port (or, when there is no port, the same host).
    return port === null || url.port === '' || url.port === String(port);
  } catch {
    return false;
  }
}
