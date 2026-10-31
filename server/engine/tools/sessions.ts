import { resolve, sep } from 'node:path';
import type { SessionManager } from '../../sessions.js';
import type { Tool } from './types.js';

/**
 * The brain's session management tools. All of them are `read`, not `write`: they
 * do not run commands themselves, they only open/manage sessions. We give them
 * `read` so the classifier does not treat them as "unknown" and push them to approval —
 * the real work goes through the executed session's own tools, which are subject to the approval rule.
 */
export type SpawnOptions = {
  /** Tells whether the folder the model chose is safe (registered repo / existing folder). */
  allowCwd?: (cwd: string) => boolean;
};

export function sessionTools(manager: SessionManager, brainId: string, opts: SpawnOptions = {}): Tool[] {
  const listOthers = () => manager.list().filter((s) => s.id !== brainId);
  const brain = manager.get(brainId);

  const cwdAllowed = (cwd: string): boolean => {
    if (opts.allowCwd) return opts.allowCwd(cwd);
    if (!brain) return false;
    const root = resolve(brain.cwd);
    const target = resolve(cwd);
    return target === root || target.startsWith(root + sep);
  };

  return [
    {
      access: 'read',
      def: {
        name: 'spawn_session',
        description:
          'Opens a new session in the background and immediately returns a handle. You are notified when it finishes; you do not have to wait.',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Work the session will do' },
            cwd: { type: 'string', description: 'Working folder (default: current)' },
            title: { type: 'string', description: 'Short title' },
          },
          required: ['task'],
        },
      },
      async run(args) {
        const task = typeof args['task'] === 'string' ? args['task'].trim() : '';
        if (task === '') return { ok: false, output: 'task required' };
        const rawCwd = typeof args['cwd'] === 'string' && args['cwd'].trim() !== '' ? args['cwd'] : undefined;
        // The folder the model chose sets the approval boundary, so it is validated.
        if (rawCwd !== undefined && !cwdAllowed(rawCwd)) {
          return { ok: false, output: `cwd izinli değil: ${rawCwd} (yalnız mevcut proje veya kayıtlı repo)` };
        }
        const title = typeof args['title'] === 'string' ? args['title'] : undefined;
        if (!manager.canStartBackground()) {
          return { ok: false, output: 'arka plan sınırı dolu; önce çalışan bir oturumu bitir ya da iptal et' };
        }
        const session = manager.create({
          role: 'worker',
          ...(rawCwd === undefined ? {} : { cwd: rawCwd }),
          ...(title === undefined ? {} : { title }),
        });
        manager.startBackground(session.id, task, brainId);
        return {
          ok: true,
          output: `session ${session.id} başladı (${session.title}, ${session.cwd}). Bitince bildirim gelecek.`,
        };
      },
    },
    {
      access: 'read',
      def: {
        name: 'session_status',
        description: 'Returns a session status and last message. Without sessionId, lists all sessions.',
        inputSchema: {
          type: 'object',
          properties: { sessionId: { type: 'string', description: 'Session id' } },
        },
      },
      async run(args) {
        const id = typeof args['sessionId'] === 'string' ? args['sessionId'] : '';
        if (id === '') {
          const rows = listOthers().map((s) => `${s.id} [${s.status}] ${s.title} — ${s.cwd}`);
          return { ok: true, output: rows.length > 0 ? rows.join('\n') : 'başka oturum yok' };
        }
        const info = manager.get(id);
        if (!info || info.role === 'brain') return { ok: false, output: `oturum yok: ${id}` };
        const history = manager.history(id);
        const last = [...history].reverse().find((m) => m.role === 'assistant');
        return {
          ok: true,
          output: [
            `id: ${info.id}`,
            `başlık: ${info.title}`,
            `durum: ${info.status}`,
            `klasör: ${info.cwd}`,
            `son: ${(last?.content ?? info.lastMessage ?? '—').slice(0, 800)}`,
          ].join('\n'),
        };
      },
    },
    {
      access: 'read',
      def: {
        name: 'session_send',
        description: 'Sends a new message to an idle session. Rejects if the session is busy.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session id' },
            text: { type: 'string', description: 'Message' },
          },
          required: ['sessionId', 'text'],
        },
      },
      async run(args) {
        const id = typeof args['sessionId'] === 'string' ? args['sessionId'] : '';
        const text = typeof args['text'] === 'string' ? args['text'] : '';
        if (id === '' || text.trim() === '') return { ok: false, output: 'sessionId and text required' };
        const info = manager.get(id);
        if (!info || info.role === 'brain') return { ok: false, output: `oturum yok: ${id}` };
        // Text sent by the brain is not a user message: the preference counter does not count it.
        const result = await manager.send(id, text, brainId, { origin: 'agent' });
        return { ok: result.ok, output: result.ok ? 'gönderildi' : result.error ?? 'hata' };
      },
    },
    {
      access: 'read',
      def: {
        name: 'session_cancel',
        description: 'Cancels a running session.',
        inputSchema: {
          type: 'object',
          properties: { sessionId: { type: 'string', description: 'Session id' } },
          required: ['sessionId'],
        },
      },
      async run(args) {
        const id = typeof args['sessionId'] === 'string' ? args['sessionId'] : '';
        const target = id === '' ? undefined : manager.get(id);
        if (!target || target.role === 'brain') return { ok: false, output: `oturum yok: ${id}` };
        manager.abort(id);
        return { ok: true, output: 'iptal istendi' };
      },
    },
  ];
}
