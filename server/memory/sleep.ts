import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { EventLog } from '../store/events.js';
import { distill, linkNotes, type Distiller, type RejectedNote } from './distill.js';
import type { MemoryStore } from './notes.js';
import { applyTraumaDetection } from './trauma.js';
import { projectKey } from '../project.js';

export type SleepOptions = {
  distiller?: Distiller;
  maxLlmCalls?: number;
  dataDir?: string;
  lockPath?: string;
  project?: string | null;
  now?: number;
};

export type SleepReport = {
  ran: boolean;
  skipped?: string;
  sessionsProcessed: number;
  notesAdded: number;
  linksAdded: number;
  conflicts: number;
  rejected: RejectedNote[];
  dormant: string[];
  woke: string[];
  /** Notes marked as trauma in this sleep. */
  traumaMarked: string[];
  llmCalls: number;
  skippedAutonomous: string[];
};

const LOCK_STALE_MS = 60 * 60 * 1000;

/**
 * Sleep: distills memories, lowers the weak into cold storage. Only one sleep runs
 * at a time (atomic `wx` lock + dead-process detection). Each session is recorded
 * with the last event id it processed; a re-run handles only the new turns.
 */
export async function sleep(log: EventLog, memory: MemoryStore, opts: SleepOptions = {}): Promise<SleepReport> {
  const lockPath = opts.lockPath ?? (opts.dataDir ? join(opts.dataDir, 'sleep.lock') : undefined);
  const empty: SleepReport = {
    ran: false,
    sessionsProcessed: 0,
    notesAdded: 0,
    linksAdded: 0,
    conflicts: 0,
    rejected: [],
    dormant: [],
    woke: [],
    traumaMarked: [],
    llmCalls: 0,
    skippedAutonomous: [],
  };

  if (lockPath) {
    const claim = acquireLock(lockPath);
    if (!claim.ok) return { ...empty, skipped: claim.reason };
  }

  try {
    const now = opts.now ?? Date.now();
    const checkpoints = readCheckpoints(log);
    const all = log.read();
    const lastEvent = all[all.length - 1]?.id ?? 0;

    let notesAdded = 0;
    let llmCalls = 0;
    let sessionsProcessed = 0;
    const rejected: RejectedNote[] = [];
    const skippedAutonomous: string[] = [];

    const sessionIds = [...new Set(all.filter((e) => e.kind === 'message').map((e) => e.sessionId))];
    for (const sessionId of sessionIds) {
      const since = checkpoints.get(sessionId) ?? 0;
      const fresh = all.filter((e) => e.sessionId === sessionId && e.id > since);
      if (fresh.length === 0) continue;

      const start = all.find((e) => e.sessionId === sessionId && e.kind === 'session_start');

      // An autonomous session distills its transcript in its own turn; sleep does not repeat it.
      // The checkpoint still advances, otherwise the session is re-examined on every sleep.
      if (start?.payload['autonomous'] === true) {
        log.append('sleep_run', 'brain', 'brain', {
          step: 'session_done',
          sessionId,
          untilEventId: Math.max(...fresh.map((e) => e.id)),
          notes: 0,
        });
        skippedAutonomous.push(sessionId);
        continue;
      }

      // The project key comes from the session's start record; notes are bound to the project.
      const sessionCwd = typeof start?.payload['cwd'] === 'string' ? start.payload['cwd'] : null;
      const project = opts.project ?? (sessionCwd ? projectKey(sessionCwd) : null);

      const outcome = await distill(memory, fresh, {
        ...(opts.maxLlmCalls === undefined ? {} : { maxLlmCalls: opts.maxLlmCalls }),
        project,
        ...(opts.distiller ? { distiller: opts.distiller } : {}),
      });
      notesAdded += outcome.added.length;
      llmCalls += outcome.llmCalls;
      rejected.push(...outcome.rejected);
      sessionsProcessed++;

      log.append('sleep_run', 'brain', 'brain', {
        step: 'session_done',
        sessionId,
        untilEventId: Math.max(...fresh.map((e) => e.id)),
        notes: outcome.added.length,
      });
    }

    // Linking runs once per sleep, only new links.
    const linksAdded = linkNotes(memory, opts.project ?? null);
    // Trauma detection after distillation/linking and before decay: trauma never goes cold.
    // Scan once: events newer than the last trauma checkpoint (spec §9.2).
    const traumaSince = readTraumaCheckpoint(log);
    const traumaEvents = log.readSince(traumaSince);
    const superseded = new Set<string>();
    for (const e of all) {
      if (e.kind !== 'memory_score' || e.payload['op'] !== 'supersede') continue;
      const noteId = String(e.payload['noteId'] ?? '');
      if (noteId !== '') superseded.add(noteId);
    }
    // The error's project comes from the cwd in the session start record; an unmatched error is global.
    const projectOfSession = new Map<string, string | null>();
    for (const e of all) {
      if (e.kind !== 'session_start') continue;
      const cwd = typeof e.payload['cwd'] === 'string' ? e.payload['cwd'] : null;
      projectOfSession.set(e.sessionId, cwd ? projectKey(cwd) : null);
    }
    const notes = memory.list({ includeDormant: true }).map((n) => ({
      id: n.id,
      text: n.text,
      createdAt: n.createdAt,
      project: n.project,
      isTrauma: n.isTrauma,
      superseded: superseded.has(n.id),
    }));
    const errors = traumaEvents
      .filter((e) => e.kind === 'error')
      .map((e) => ({
        message: String(e.payload['message'] ?? ''),
        ts: e.ts,
        project: projectOfSession.get(e.sessionId) ?? null,
      }));
    const corrections = traumaEvents
      .filter((e) => e.kind === 'memory_score' && (e.payload['op'] === 'correct' || e.payload['op'] === 'supersede'))
      // A trauma lesson belongs to the corrected note: in a text correction the new id is carried in the payload.
      .map((e) => {
        const raw = e.payload['op'] === 'supersede' ? e.payload['newNoteId'] : e.payload['noteId'];
        return {
          noteId: typeof raw === 'string' ? raw : '',
          cortisol: Number(e.payload['cortisol'] ?? 0),
        };
      })
      .filter((c) => c.noteId !== '');
    const traumaMarked = applyTraumaDetection(memory, { notes, errors, corrections });
    log.append('sleep_run', 'brain', 'brain', { step: 'trauma_scan', untilEventId: lastEvent });
    const decayed = memory.decay(now);

    log.append('sleep_run', 'brain', 'brain', {
      step: 'complete',
      sessions: sessionsProcessed,
      untilEventId: lastEvent,
      notes: notesAdded,
      dormant: decayed.dormant.length,
      llmCalls,
    });

    return {
      ran: true,
      sessionsProcessed,
      notesAdded,
      linksAdded,
      conflicts: memory.conflicts().length,
      rejected,
      dormant: decayed.dormant,
      woke: decayed.woke,
      traumaMarked,
      llmCalls,
      skippedAutonomous,
    };
  } finally {
    if (lockPath) rmSync(lockPath, { force: true });
  }
}

/** Last processed event id per session. */
export function readCheckpoints(log: EventLog): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of log.read()) {
    if (event.kind !== 'sleep_run' || event.payload['step'] !== 'session_done') continue;
    const sessionId = String(event.payload['sessionId'] ?? '');
    const until = Number(event.payload['untilEventId'] ?? 0);
    if (sessionId !== '' && Number.isFinite(until)) {
      map.set(sessionId, Math.max(map.get(sessionId) ?? 0, until));
    }
  }
  return map;
}

/** Event id where the last trauma scan ended: old errors are not scanned again. */
export function readTraumaCheckpoint(log: EventLog): number {
  let until = 0;
  for (const event of log.read()) {
    if (event.kind !== 'sleep_run' || event.payload['step'] !== 'trauma_scan') continue;
    const value = Number(event.payload['untilEventId'] ?? 0);
    if (Number.isFinite(value)) until = Math.max(until, value);
  }
  return until;
}

type LockClaim = { ok: true } | { ok: false; reason: string };

/**
 * Atomic lock: created with `wx`, two processes cannot claim it at the same time.
 * If the owning process died or the lock is stale, ownership is taken over.
 */
export function acquireLock(lockPath: string): LockClaim {
  mkdirSync(join(lockPath, '..'), { recursive: true });

  const existing = readLock(lockPath);
  if (existing !== null) {
    if (isAlive(existing.pid) && Date.now() - existing.at < LOCK_STALE_MS) {
      return { ok: false, reason: `uyku zaten çalışıyor (pid ${existing.pid})` };
    }
    rmSync(lockPath, { force: true }); // stale lock, or the owner died
  }

  try {
    const fd = openSync(lockPath, 'wx');
    writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
    closeSync(fd);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'uyku kilidi alınamadı' };
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock(lockPath: string): { pid: number; at: number } | null {
  if (!existsSync(lockPath)) return null;
  try {
    if (statSync(lockPath).size === 0) return { pid: 0, at: 0 };
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number; at?: number };
    return { pid: Number(parsed.pid ?? 0), at: Number(parsed.at ?? 0) };
  } catch {
    return { pid: 0, at: 0 };
  }
}

/** If sleep was interrupted, tells which sessions were processed up to where. */
export function sleepProgress(log: EventLog): {
  done: { sessionId: string; untilEventId: number }[];
  lastRun: string | null;
} {
  const runs = log.read().filter((e) => e.kind === 'sleep_run');
  return {
    done: runs
      .filter((e) => e.payload['step'] === 'session_done')
      .map((e) => ({
        sessionId: String(e.payload['sessionId'] ?? ''),
        untilEventId: Number(e.payload['untilEventId'] ?? 0),
      })),
    lastRun: runs.length > 0 ? String(runs[runs.length - 1]?.payload['step'] ?? '') : null,
  };
}
