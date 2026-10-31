import { describe, it, expect } from 'vitest';
import { EventLog } from '../server/store/events.js';
import { MemoryStore } from '../server/memory/notes.js';
import { ApprovalBroker } from '../server/http/approvals.js';
import { buildDashboard } from '../server/dashboard.js';
import type { SessionInfo } from '../server/sessions.js';

const session = (over: Partial<SessionInfo>): SessionInfo => ({
  id: 's1',
  title: 'KAREN',
  cwd: 'C:\\p',
  role: 'brain',
  status: 'idle',
  createdAt: Date.now(),
  ...over,
});

function setup() {
  const log = new EventLog(':memory:');
  const memory = new MemoryStore(log);
  return { log, memory, approvals: new ApprovalBroker() };
}

const voice = { status: 'unavailable' as const, lang: 'tr-TR' };

describe('buildDashboard', () => {
  it('derives memory counts from real notes', () => {
    const { log, memory, approvals } = setup();
    memory.add({ kind: 'semantic', text: 'PDF puppeteer ile üretilir', evidence: [1], base: 0.8, project: 'p1' });
    memory.add({ kind: 'episodic', text: 'oturumda rapor üretildi', evidence: [1], base: 0.5 });
    memory.add({ kind: 'semantic', text: 'veritabanı yedeği gece alınır', evidence: [1], base: 0.6, project: 'p2' });

    const data = buildDashboard({ sessions: [session({})], memory, approvals, logEvents: log.read(), voice });
    expect(data.memory.notes).toBe(3);
    expect(data.memory.semantic).toBe(2);
    expect(data.memory.episodic).toBe(1);
    expect(data.memory.projects).toBe(2);
  });

  it('lists recent tool operations in reverse', () => {
    const { log, memory, approvals } = setup();
    log.append('tool_call', 'session', 's1', { tool: 'run_command', args: {}, className: 'important' });
    log.append('tool_result', 'system', 's1', { tool: 'run_command', ok: true }, '42');
    log.append('tool_result', 'system', 's1', { tool: 'read_file', ok: false }, 'yok');

    const data = buildDashboard({ sessions: [session({})], memory, approvals, logEvents: log.read(), voice });
    expect(data.recentActions[0]?.tool).toBe('read_file');
    expect(data.recentActions[1]?.tool).toBe('run_command');
    expect(data.recentActions[1]?.detail).toBe('42');
    expect(data.toolCalls).toBe(1);
  });

  it('onay bekleyen varsa durum attention olur', async () => {
    const { log, memory, approvals } = setup();
    void approvals.ask('s1', { tool: 'run_command', access: 'exec', args: {}, cwd: '.' }, () => undefined);
    const data = buildDashboard({ sessions: [session({})], memory, approvals, logEvents: log.read(), voice });
    expect(data.pendingApprovals).toBe(1);
    expect(data.status).toBe('attention');
    expect(data.events.some((e) => e.text.includes('onay bekliyor'))).toBe(true);
    approvals.cancelSession('s1');
  });

  it('busy when a session is running, optimal otherwise', () => {
    const { log, memory, approvals } = setup();
    const idle = buildDashboard({ sessions: [session({})], memory, approvals, logEvents: log.read(), voice });
    expect(idle.status).toBe('optimal');

    const busy = buildDashboard({
      sessions: [session({}), session({ id: 'w1', role: 'worker', status: 'running' })],
      memory,
      approvals,
      logEvents: log.read(),
      voice,
    });
    expect(busy.status).toBe('busy');
    expect(busy.activeAgents).toBe(1);
  });

  it('emits a warning when a conflict exists', () => {
    const { log, memory, approvals } = setup();
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanıyor', evidence: [1], base: 0.8 });
    memory.add({ kind: 'semantic', text: 'Kullanıcı TypeScript kullanmıyor', evidence: [2], base: 0.8 });

    const data = buildDashboard({ sessions: [session({})], memory, approvals, logEvents: log.read(), voice });
    expect(data.memory.conflicts).toBe(1);
    expect(data.status).toBe('attention');
  });

  it('takes the user turn count from the event log', () => {
    const { log, memory, approvals } = setup();
    log.append('message', 'user', 's1', { role: 'user' }, 'bir');
    log.append('message', 'session', 's1', { role: 'assistant' }, 'iki');
    log.append('message', 'user', 's1', { role: 'user' }, 'üç');

    const data = buildDashboard({ sessions: [session({})], memory, approvals, logEvents: log.read(), voice });
    expect(data.turns).toBe(2);
  });

  it('trauma and intuition counts reach the dashboard', () => {
    const { log, memory, approvals } = setup();
    const note = memory.add({ kind: 'semantic', text: 'kalıcı ders', evidence: [1], base: 0.5 });
    memory.markTrauma(note.id, 'kullanici');
    // a trauma note never lands in cold storage; but migration/old data may leave it cold.
    // the count must come from the includeDormant list.
    log.database.prepare('UPDATE memory_notes SET dormant = 1 WHERE id = ?').run(note.id);
    const data = buildDashboard({
      sessions: [], memory, approvals, logEvents: log.read(), voice,
      intuitions: 2,
    });
    expect(data.memory.trauma).toBe(1);
    expect(data.intuitions).toBe(2);
  });

  it('the intuition count defaults to zero', () => {
    const { log, memory, approvals } = setup();
    const data = buildDashboard({ sessions: [], memory, approvals, logEvents: log.read(), voice });
    expect(data.intuitions).toBe(0);
    expect(data.memory.trauma).toBe(0);
  });

  it('the state vector reaches the dashboard', () => {
    const { log, memory, approvals } = setup();
    const data = buildDashboard({
      sessions: [],
      memory,
      approvals,
      logEvents: log.read(),
      voice,
      state: { cortisol: 0.8, dopamine: 0.3, serotonin: 0.5, fatigue: 0.2, circadian: 0.9, phase: 'gunduz' as const, at: 0, temperature: 0.3 },
    });
    expect(data.state?.cortisol).toBe(0.8);
    expect(data.state?.phase).toBe('gunduz');
  });
});
