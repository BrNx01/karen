import type { EventLog, StoredEvent } from '../store/events.js';
import {
  applySignal,
  decay,
  initialState,
  temperatureOf,
  type EmotionKey,
  type Phase,
  type StateSignal,
  type StateVector,
} from './state.js';

/**
 * State vector projection: the event log is the single source, the table is built only from it.
 * Derivable signals are not written again here, or they would be counted twice on replay.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS state_vector (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  at INTEGER NOT NULL,
  cortisol REAL NOT NULL,
  dopamine REAL NOT NULL,
  serotonin REAL NOT NULL,
  fatigue REAL NOT NULL,
  circadian REAL NOT NULL,
  phase TEXT NOT NULL,
  source TEXT NOT NULL,
  last_event_id INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS state_history (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  cortisol REAL NOT NULL, dopamine REAL NOT NULL, serotonin REAL NOT NULL,
  fatigue REAL NOT NULL, circadian REAL NOT NULL, phase TEXT NOT NULL
);
`;

const CRISIS = /acil|kriz|çöktü|coktu|bozuk|çalışmıyor|calismiyor/i;
const NEW_PROJECT = /yeni proje|fikir|öneri|denesek/i;
/** Only verification work (test/build) is rewarded; plain reads are not. */
const VERIFY_COMMAND = /test|build|tsc|vitest|typecheck|derle|compile/i;
const EMOTIONS = new Set<EmotionKey>(['cortisol', 'dopamine', 'serotonin', 'fatigue']);

/** Classification of user text; the live path and replay use the same source. */
export function classifyUserText(text: string): { crisis: boolean; newProject: boolean } {
  return { crisis: CRISIS.test(text), newProject: NEW_PROJECT.test(text) };
}

type Row = {
  at: number;
  cortisol: number;
  dopamine: number;
  serotonin: number;
  fatigue: number;
  circadian: number;
  phase: Phase;
  source: string;
  last_event_id: number;
};

function toVector(row: Row): StateVector {
  return {
    at: row.at,
    cortisol: row.cortisol,
    dopamine: row.dopamine,
    serotonin: row.serotonin,
    fatigue: row.fatigue,
    circadian: row.circadian,
    phase: row.phase,
  };
}

/** The signals carried by one event-log event (spec §6.4 table). */
function signalsOf(event: StoredEvent): StateSignal[] {
  const payload = event.payload;
  switch (event.kind) {
    case 'error':
      return [{ kind: 'error' }];
    case 'tool_result': {
      if (payload['ok'] !== true || payload['tool'] !== 'run_command') return [];
      const command = payload['command'];
      return typeof command === 'string' && VERIFY_COMMAND.test(command) ? [{ kind: 'tool_ok' }] : [];
    }
    case 'memory_score': {
      const op = payload['op'];
      return op === 'correct' || op === 'supersede' ? [{ kind: 'correction' }] : [];
    }
    case 'message': {
      if (payload['role'] !== 'user') return [];
      const signals: StateSignal[] = [{ kind: 'turn' }];
      // Use the classification if it was written; otherwise derive from the body (the signal survives even if redaction wipes the body).
      const fallback = classifyUserText(event.body ?? String(payload['text'] ?? ''));
      const crisis = typeof payload['crisis'] === 'boolean' ? payload['crisis'] : fallback.crisis;
      const newProject = typeof payload['newProject'] === 'boolean' ? payload['newProject'] : fallback.newProject;
      if (crisis) signals.push({ kind: 'crisis_words' });
      if (newProject) signals.push({ kind: 'new_project' });
      return signals;
    }
    case 'state_signal': {
      const signal = payload['signal'] as StateSignal | undefined;
      return signal ? [signal] : [];
    }
    case 'state_feel': {
      const emotion = payload['emotion'] as EmotionKey;
      if (!EMOTIONS.has(emotion)) return [];
      return [{ kind: 'feel', emotion, delta: Number(payload['delta']) }];
    }
    // Audit snapshot: not a source, not counted on replay.
    case 'state_change':
      return [];
    default:
      return [];
  }
}

export class StateStore {
  private readonly db;

  constructor(
    private readonly log: EventLog,
    private readonly now: () => number = Date.now,
  ) {
    this.db = log.database;
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Adds missing columns to old databases; does not touch the event log. */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(state_vector)').all() as { name: string }[];
    const has = (name: string) => columns.some((c) => c.name === name);
    if (!has('last_event_id')) {
      this.db.exec('ALTER TABLE state_vector ADD COLUMN last_event_id INTEGER NOT NULL DEFAULT 0');
      // The old row carries no version tracking: replay from scratch instead of appending on top.
      this.db.exec('DELETE FROM state_vector');
    }
    if (!has('source')) {
      this.db.exec("ALTER TABLE state_vector ADD COLUMN source TEXT NOT NULL DEFAULT 'replay'");
    }
  }

  private load(): { state: StateVector; lastEventId: number } | null {
    const row = this.db.prepare('SELECT * FROM state_vector WHERE id = 1').get() as Row | undefined;
    return row ? { state: toVector(row), lastEventId: row.last_event_id } : null;
  }

  /** Applies unprocessed events in order (incremental). */
  sync(): void {
    const lastEventId = this.load()?.lastEventId ?? 0;
    const events = this.log.readSince(lastEventId);
    // A large replay in one transaction: avoids a commit per row on the first pass.
    this.db.transaction(() => {
      for (const event of events) this.apply(event);
    })();
  }

  /** Read path: applies the stored state and decays to "now"; does not write to the log. */
  current(): StateVector {
    this.sync();
    const stored = this.load();
    const now = this.now();
    return stored ? decay(stored.state, now) : decay(initialState(now), now);
  }

  /**
   * Only non-derivable signals are written (`feel`, `context_bloat`, `task_done`).
   * If a derived signal passed through here it would be counted twice: error out.
   */
  record(signal: StateSignal): void {
    this.sync();
    let event: StoredEvent;
    if (signal.kind === 'feel') {
      event = this.log.append('state_feel', 'brain', 'brain', {
        emotion: signal.emotion,
        delta: signal.delta,
      });
    } else if (signal.kind === 'context_bloat' || signal.kind === 'task_done') {
      event = this.log.append('state_signal', 'brain', 'brain', { signal });
    } else {
      throw new Error(`türetilen sinyal record edilmez: ${signal.kind}`);
    }
    this.apply(event, 'turn');
  }

  /** Audit snapshot: event + history row; not counted as a source on replay. */
  snapshot(): void {
    const state = this.current();
    this.log.append('state_change', 'system', 'brain', { derived: true, ...state });
    this.db
      .prepare(
        `INSERT INTO state_history (at, cortisol, dopamine, serotonin, fatigue, circadian, phase)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        state.at,
        state.cortisol,
        state.dopamine,
        state.serotonin,
        state.fatigue,
        state.circadian,
        state.phase,
      );
  }

  /** Applies a single event: first decay to the event time, then add the signals. */
  apply(event: StoredEvent, source: 'replay' | 'turn' = 'replay'): void {
    const stored = this.load();
    let state = stored ? decay(stored.state, event.ts) : initialState(event.ts);
    for (const signal of signalsOf(event)) state = applySignal(state, signal, event.ts);
    this.save(state, event.id, source);
  }

  /** Deletes the table, rebuilds it from the event log and decays to "now". */
  replay(): StateVector {
    this.db.exec('DELETE FROM state_vector; DELETE FROM state_history;');
    const events = this.log.read();
    this.db.transaction(() => {
      for (const event of events) this.apply(event);
    })();
    return this.current();
  }

  history(limit = 50): StateVector[] {
    const rows = this.db
      .prepare('SELECT * FROM state_history ORDER BY id DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map(toVector);
  }

  temperature(): number {
    return temperatureOf(this.current());
  }

  private save(state: StateVector, lastEventId: number, source: 'replay' | 'turn'): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO state_vector
           (id, at, cortisol, dopamine, serotonin, fatigue, circadian, phase, source, last_event_id)
         VALUES (1,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        state.at,
        state.cortisol,
        state.dopamine,
        state.serotonin,
        state.fatigue,
        state.circadian,
        state.phase,
        source,
        lastEventId,
      );
  }
}
