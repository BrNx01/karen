import type { ApprovalBroker } from './http/approvals.js';
import type { StateVector } from './brain/state.js';
import type { MemoryStore } from './memory/notes.js';
import type { SessionInfo } from './sessions.js';
import type { StoredEvent } from './store/events.js';

export type DashboardAction = {
  id: number;
  at: number;
  tool: string;
  ok: boolean;
  detail: string;
};

export type DashboardData = {
  status: 'optimal' | 'busy' | 'attention';
  sessions: SessionInfo[];
  activeAgents: number;
  pendingApprovals: number;
  memory: {
    notes: number;
    semantic: number;
    episodic: number;
    dormant: number;
    conflicts: number;
    projects: number;
    trauma: number;
  };
  recentActions: DashboardAction[];
  events: { at: number; text: string; tone: 'info' | 'warn' | 'ok' }[];
  voice: { status: 'unavailable' | 'ready' | 'no-model'; lang: string };
  toolCalls: number;
  turns: number;
  /** Real process measurements (nothing made up). */
  system: { rssMb: number; heapMb: number; uptimeSec: number; cpuPercent: number };
  provider: { active: string; model: string };
  /** Number of growth proposals awaiting approval. */
  pendingProposals?: number;
  /** Number of unread autonomous notes. */
  unreadInbox?: number;
  /** Internal state vector + sampling temperature. */
  state?: StateVector & { temperature: number };
  /** Number of derived intuitions. */
  intuitions?: number;
};

const MAX_ACTIONS = 8;
const MAX_EVENTS = 10;

/** CPU percent: the difference between two samples. Kept at module level. */
let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();

function sampleCpu(): number {
  const now = Date.now();
  const usage = process.cpuUsage(lastCpu);
  const elapsedMs = Math.max(1, now - lastCpuAt);
  lastCpu = process.cpuUsage();
  lastCpuAt = now;
  const cpuMs = (usage.user + usage.system) / 1000;
  return Math.min(100, Math.round((cpuMs / elapsedMs) * 100));
}

/**
 * The dashboard is fed in a single request: the UI does not make 10 separate calls.
 * Every number comes from the real state of the existing stores; nothing is made up.
 */
export function buildDashboard(input: {
  sessions: SessionInfo[];
  memory: MemoryStore;
  approvals: ApprovalBroker;
  logEvents: StoredEvent[];
  voice: { status: 'unavailable' | 'ready' | 'no-model'; lang: string };
  provider?: { active: string; model: string };
  pendingProposals?: number;
  unreadInbox?: number;
  state?: StateVector & { temperature: number };
  intuitions?: number;
}): DashboardData {
  const notes = input.memory.list({ includeDormant: true, includeForgotten: false });
  const semantic = notes.filter((n) => n.kind === 'semantic').length;
  const episodic = notes.filter((n) => n.kind === 'episodic').length;
  const dormant = notes.filter((n) => n.dormant).length;
  const trauma = notes.filter((n) => n.isTrauma).length;
  const conflicts = input.memory.conflicts().length;
  const projects = new Set(notes.map((n) => n.project).filter((p): p is string => p !== null)).size;

  const toolResults = input.logEvents.filter((e) => e.kind === 'tool_result');
  const recentActions: DashboardAction[] = toolResults
    .slice(-MAX_ACTIONS)
    .reverse()
    .map((e) => ({
      id: e.id,
      at: e.ts,
      tool: String(e.payload['tool'] ?? 'tool'),
      ok: e.payload['ok'] === true,
      detail: (e.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    }));

  const activeAgents = input.sessions.filter(
    (s) => s.role === 'worker' && (s.status === 'running' || s.status === 'waiting'),
  ).length;
  const running = input.sessions.some((s) => s.status === 'running' || s.status === 'waiting');
  const hasError = input.sessions.some((s) => s.status === 'error');
  const pendingApprovals = input.approvals.pending().length;
  const lastError = [...input.logEvents].reverse().find((e) => e.kind === 'error');

  const events: DashboardData['events'] = [];
  if (pendingApprovals > 0) {
    events.push({ at: Date.now(), text: `${pendingApprovals} approvals pending`, tone: 'warn' });
  }
  if (conflicts > 0) {
    events.push({ at: Date.now(), text: `${conflicts} conflicting memories awaiting resolution`, tone: 'warn' });
  }
  for (const action of recentActions.slice(0, 5)) {
    events.push({
      at: action.at,
      text: `${action.tool}: ${action.detail || (action.ok ? 'ok' : 'failed')}`,
      tone: action.ok ? 'ok' : 'warn',
    });
  }
  if (lastError) {
    events.push({ at: lastError.ts, text: `error: ${String(lastError.payload['message'] ?? '')}`.slice(0, 140), tone: 'warn' });
  }
  if (episodic > 0) {
    events.push({ at: Date.now(), text: `${episodic} episodic, ${semantic} semantic memories recalled`, tone: 'info' });
  }

  return {
    status: pendingApprovals > 0 || conflicts > 0 || hasError ? 'attention' : running ? 'busy' : 'optimal',
    sessions: input.sessions,
    activeAgents,
    pendingApprovals,
    memory: { notes: notes.length, semantic, episodic, dormant, conflicts, projects, trauma },
    recentActions,
    events: events.slice(0, MAX_EVENTS),
    voice: input.voice,
    toolCalls: input.logEvents.filter((e) => e.kind === 'tool_call').length,
    turns: input.logEvents.filter((e) => e.kind === 'message' && e.payload['role'] === 'user').length,
    system: {
      rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
      heapMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
      uptimeSec: Math.round(process.uptime()),
      cpuPercent: sampleCpu(),
    },
    provider: input.provider ?? { active: 'bilinmiyor', model: '—' },
    pendingProposals: input.pendingProposals ?? 0,
    intuitions: input.intuitions ?? 0,
    ...(input.unreadInbox === undefined ? {} : { unreadInbox: input.unreadInbox }),
    ...(input.state === undefined ? {} : { state: input.state }),
  };
}
