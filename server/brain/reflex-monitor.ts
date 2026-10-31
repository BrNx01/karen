import type { EventLog } from '../store/events.js';
import { assess } from './reflex.js';

/** The same reflex EVENT is written once every 5 minutes; the kill decision is independent of it. */
export const REFLEX_EVENT_MS = 5 * 60_000;

export type MonitorSession = { id: string; role: string; status: string; createdAt: number };

export type ReflexMonitorDeps = {
  list(): MonitorSession[];
  abort(id: string): void;
  notify(sessionId: string | undefined, text: string): void;
  brain(): { id: string } | undefined;
  log: Pick<EventLog, 'append'>;
};

export type ReflexMonitorState = { killed: Set<string>; eventAt: number };

export function reflexMonitorState(): ReflexMonitorState {
  // eventAt = -Infinity: the first tick must write the event for sure (0 would stall 5 min in tests with fake clocks).
  return { killed: new Set(), eventAt: Number.NEGATIVE_INFINITY };
}

/**
 * One monitor pass. The pure decision comes from `assess`; only the kill and the event write live here.
 * Dedupe covers only the event: while RAM stays high, the next victim is stopped on every tick.
 */
export function reflexTick(
  state: ReflexMonitorState,
  deps: ReflexMonitorDeps,
  mem: { rssMb: number; totalMb: number },
  now: number,
): { action: 'none' } | { action: 'kill-oldest'; victimId: string } {
  const running = deps.list().filter((s) => s.role === 'worker' && s.status === 'running');
  // A finished session drops from the set: if the id runs again it may be a victim again.
  const alive = new Set(running.map((s) => s.id));
  for (const id of [...state.killed]) if (!alive.has(id)) state.killed.delete(id);

  const verdict = assess({ rssMb: mem.rssMb, totalMb: mem.totalMb, repeats: 0, tool: '' });
  if (verdict.action !== 'kill-oldest') return { action: 'none' };

  const victim = running
    .filter((s) => !state.killed.has(s.id))
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!victim) return { action: 'none' };

  // Record only when both the kill and the event write succeed: a thrown error must not exempt the victim forever.
  deps.abort(victim.id);

  if (now - state.eventAt >= REFLEX_EVENT_MS) {
    deps.log.append('reflex', 'system', victim.id, {
      action: 'kill-oldest',
      reason: verdict.reason,
      rssMb: Math.round(mem.rssMb),
      totalMb: Math.round(mem.totalMb),
    });
    // The notification is deduped together with the event too: the notification queue must not swell every tick.
    const brain = deps.brain();
    if (brain) deps.notify(brain.id, 'Sistem kilitleniyordu, refleks en eski oturumu durdurdu.');
    state.eventAt = now;
  }

  // The set holds only live workers; the count is capped by maxBackground (≤6), so a separate ceiling is unnecessary.
  state.killed.add(victim.id);
  return { action: 'kill-oldest', victimId: victim.id };
}
