import type { EventLog, StoredEvent } from '../store/events.js';
import type { MemoryStore } from '../memory/notes.js';
import { distill, urlCited, DISTILL_MODEL_FAILED, type Distiller } from '../memory/distill.js';
import { projectKey } from '../project.js';
import type { SessionManager } from '../sessions.js';
import type { IdleClock } from './activity.js';
import type { InboxKind, InboxStore } from './inbox.js';
import { selectDrive, type Drive, type DriveName } from './drives.js';

export type DmnDeps = {
  sessions: SessionManager;
  log: EventLog;
  inbox: InboxStore;
  idle: IdleClock;
  memory: MemoryStore;
  /** Same bridge as sleep; without it only the deterministic episodic summary is written. */
  distiller?: Distiller;
  /** The research permission lives where the session is created (SessionManager), not here. */
  settings: () => { enabled: boolean; idleMinutes: number; dailyRuns: number };
  now?: () => number;
  cwd: string;
  lastDrive?: DriveName | null;
  buildDriveInput: () => { logOk: boolean; unknownTerms: string[]; styleSignals: string[] };
  /** A scheduler error goes here, not to the log; the log itself may be unwritable. */
  onError?: (message: string) => void;
};

const UNVERIFIED_URL = '[kaynak doğrulanamadı]';

const COOLDOWN_MS = 10 * 60_000;
const INBOX_KIND: Record<DriveName, InboxKind> = {
  integrity: 'warning',
  curiosity: 'research',
  style: 'suggestion',
};

/**
 * Default mode network: while the user is away it picks a drive, opens an
 * autonomous turn, distills that turn at the same time and leaves a one-line
 * inbox item for the morning.
 */
export class Dmn {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Only one DMN turn at a time; a second tick is rejected without waiting. */
  private running = false;
  private lastDrive: DriveName | null;
  private repeats = 0;
  /** Successful turn times. Seeded from the event log so a restart does not reset the limit. */
  private readonly runAt: number[];
  /** Last attempt (including failures): the cooldown applies to attempts too. */
  private lastAttempt: number | null = null;
  /** Last error thrown in the scheduler; the scheduler cannot write to the log. */
  private lastError: string | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: DmnDeps) {
    this.now = deps.now ?? Date.now;
    const runs = deps.log.read().filter((e) => e.kind === 'dmn_run');
    // A failed attempt does not burn the daily quota, but it keeps the cooldown across restarts.
    this.runAt = runs.filter((e) => e.payload['ok'] !== false).map((e) => Number(e.payload['at'] ?? e.ts));
    const attempts = runs.map((e) => Number(e.payload['at'] ?? e.ts));
    this.lastAttempt = attempts.length === 0 ? null : Math.max(...attempts);
    this.lastDrive = deps.lastDrive ?? lastDriveOf(runs);
  }

  /** One turn attempt. If the conditions do not hold, {ran:false, reason}. */
  tick(now: number): { ran: boolean; reason?: string; sessionId?: string } {
    if (this.stopped) return { ran: false, reason: 'durduruldu' };

    const settings = this.deps.settings();
    if (!settings.enabled) return { ran: false, reason: 'kapalı' };
    if (!this.deps.idle.isIdle(settings.idleMinutes)) return { ran: false, reason: 'kullanıcı etkin' };

    // Conditions checked BEFORE opening a session: no session and no tokens wasted.
    if (this.running || this.busySession()) return { ran: false, reason: 'oturum meşgul' };
    if (!this.deps.sessions.canStartBackground()) return { ran: false, reason: 'arka plan sınırı' };

    // The cooldown covers attempts too: a provider that keeps failing does not open a session every minute.
    if (this.lastAttempt !== null && now - this.lastAttempt < COOLDOWN_MS) return { ran: false, reason: 'bekleme' };
    if (this.runsToday(now) >= settings.dailyRuns) return { ran: false, reason: 'günlük sınır' };

    const drive = selectDrive({
      ...this.deps.buildDriveInput(),
      lastDrive: this.lastDrive,
      repeats: this.repeats,
    });
    if (!drive) return { ran: false, reason: 'dürtü yok' };

    let sessionId: string;
    this.lastAttempt = now;
    try {
      sessionId = this.deps.sessions.create({
        role: 'worker',
        autonomous: true,
        title: 'otonom',
        cwd: this.deps.cwd,
      }).id;
    } catch (err) {
      // If the session could not be opened, the lock must not stay stuck; the next tick retries.
      this.deps.log.append('error', 'system', 'brain', { message: `dmn oturum: ${(err as Error).message}` });
      return { ran: false, reason: 'oturum açılamadı' };
    }

    // The flag is set AFTER create: a throwing create does not leave the lock behind.
    this.running = true;
    this.repeats = drive.name === this.lastDrive ? this.repeats + 1 : 1;
    this.lastDrive = drive.name;
    void this.run(drive, sessionId, now);
    return { ran: true, sessionId };
  }

  start(intervalMs = 60_000): void {
    this.stop();
    // A stopped timer can be reopened with start().
    this.stopped = false;
    // An error thrown in the timer must not crash the process; the log may be closed too.
    this.timer = setInterval(() => {
      try {
        this.tick(this.now());
      } catch (err) {
        this.lastError = (err as Error).message;
        this.deps.onError?.(this.lastError);
      }
    }, intervalMs);
  }

  /** Idempotent: safe after a second call and after start(). */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopped = true;
  }

  stats(): { runsToday: number; lastRunAt: number | null; lastError: string | null } {
    return { runsToday: this.runsToday(this.now()), lastRunAt: this.lastRunAt(), lastError: this.lastError };
  }

  /** The whole turn: send → distill in the same turn → inbox line → dmn_run. */
  private async run(drive: Drive, sessionId: string, now: number): Promise<void> {
    try {
      // The autonomous drive prompt is not a user message: it is marked agent-originated in the log.
      const sent = await this.deps.sessions.send(sessionId, drive.prompt, undefined, { origin: 'agent' });
      // stop() does not cut an in-flight turn; leave here without writing to a closed log.
      if (this.stopped) return;
      if (!sent.ok) {
        // A failed turn does not burn the quota; the error goes to the report, not the log's error channel.
        this.deps.log.append('dmn_run', 'brain', 'brain', {
          drive: drive.name,
          sessionId,
          notes: 0,
          inboxId: null,
          at: now,
          ok: false,
          error: sent.error ?? 'bilinmeyen hata',
        });
        return;
      }

      let notes = 0;
      let distillError: string | undefined;
      try {
        // Notes are written BEFORE the inbox line: the morning report must see them.
        const outcome = await distill(this.deps.memory, this.deps.log.read(sessionId), {
          project: projectKey(this.deps.cwd),
          ...(this.deps.distiller ? { distiller: this.deps.distiller } : {}),
        });
        notes = outcome.added.length;
        // A model error is swallowed but not hidden: it is also written to the report.
        if (outcome.rejected.some((r) => r.reason === DISTILL_MODEL_FAILED)) distillError = DISTILL_MODEL_FAILED;
      } catch (err) {
        // A distillation error does not drop the turn; the error goes to the report.
        distillError = (err as Error).message;
      }
      // A shutdown may have arrived during distillation: leave here before the first write.
      if (this.stopped) return;

      const last = [...this.deps.sessions.history(sessionId)].reverse().find((m) => m.role === 'assistant');
      const raw = (last?.content ?? '').trim().slice(0, 300) || `${drive.name}: çıktı yok`;
      // The inbox line is raw model output: an address without a source must not reach the user.
      const text = guardUrls(raw, toolSources(this.deps.log.read(sessionId)));
      if (this.stopped) return;
      const item = this.deps.inbox.add({ kind: INBOX_KIND[drive.name], text, refs: [sessionId] });
      this.deps.log.append('dmn_run', 'brain', 'brain', {
        drive: drive.name,
        sessionId,
        notes,
        inboxId: item?.id ?? null,
        at: now,
        ...(distillError ? { distillError } : {}),
      });
      // The quota burns only on a completed turn.
      this.runAt.push(now);
      // The transcript stays in the log; the in-memory copy must not accumulate.
      this.deps.sessions.pruneWorkers();
    } catch (err) {
      // At shutdown the log is closed: a second error must not escape the void-started turn.
      if (this.stopped) return;
      try {
        this.deps.log.append('error', 'system', sessionId, { message: (err as Error).message });
      } catch {
        // swallowed: an unwritable report must not crash the process
      }
    } finally {
      this.running = false;
    }
  }

  private busySession(): boolean {
    return this.deps.sessions.list().some((s) => s.status === 'running' || s.status === 'waiting');
  }

  private lastRunAt(): number | null {
    return this.runAt.length === 0 ? null : this.runAt.reduce((a, b) => Math.max(a, b));
  }

  private runsToday(now: number): number {
    const day = localDay(now);
    return this.runAt.filter((t) => localDay(t) === day).length;
  }
}

function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** URL evidence: the session's tool results (same "source" definition as distillation). */
function toolSources(events: StoredEvent[]): string {
  return events
    .filter((e) => e.kind === 'tool_result')
    .map((e) => `${e.body ?? ''} ${JSON.stringify(e.payload)}`)
    .join(' ');
}

/** Marks an address without a source instead of dropping the line. */
function guardUrls(text: string, source: string): string {
  return text.replace(/https?:\/\/\S+/g, (url) => {
    const trimmed = url.replace(/[).,;:!?]+$/, '');
    const cited = urlCited(url, source) || (trimmed !== url && urlCited(trimmed, source));
    return cited ? url : UNVERIFIED_URL;
  });
}

function lastDriveOf(runs: StoredEvent[]): DriveName | null {
  const last = runs[runs.length - 1];
  const name = last?.payload['drive'];
  return name === 'integrity' || name === 'curiosity' || name === 'style' ? name : null;
}
