/**
 * KAREN's internal state: four hormone-like values + circadian phase.
 *
 * Pure module: no imports, no side effects. The same vector + the same signal
 * sequence always yields the same vector, so tests and reproduction are possible.
 */

export type Phase = 'gece' | 'sabah' | 'gunduz' | 'aksam';

export type StateVector = {
  at: number;
  cortisol: number;
  dopamine: number;
  serotonin: number;
  fatigue: number;
  circadian: number;
  phase: Phase;
};

export type EmotionKey = 'cortisol' | 'dopamine' | 'serotonin' | 'fatigue';

export type StateSignal =
  | { kind: 'error' }
  | { kind: 'crisis_words' }
  | { kind: 'tool_ok' }
  | { kind: 'new_project' }
  | { kind: 'correction' }
  | { kind: 'turn' }
  | { kind: 'context_bloat' }
  | { kind: 'task_done' }
  | { kind: 'feel'; emotion: EmotionKey; delta: number };

export const BASELINE: Record<EmotionKey, number> = Object.freeze({
  cortisol: 0.10,
  dopamine: 0.35,
  serotonin: 0.50,
  fatigue: 0.05,
});

const MINUTE = 60_000;

export const HALF_LIFE_MS: Record<EmotionKey, number> = {
  cortisol: 15 * MINUTE,
  dopamine: 40 * MINUTE,
  serotonin: 2 * 60 * MINUTE,
  fatigue: 8 * 60 * MINUTE,
};

/** The largest change the model may push in one go with its `feel` signal. */
export const MAX_MODEL_DELTA = 0.10;

const EMOTIONS: readonly EmotionKey[] = ['cortisol', 'dopamine', 'serotonin', 'fatigue'];

/** Night fatigue floor: hours spent awake push the floor up. */
const NIGHT_FATIGUE_BONUS = 0.15;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);

export function phaseAt(now: number): Phase {
  const hour = new Date(now).getHours();
  if (hour < 6) return 'gece';
  if (hour < 11) return 'sabah';
  if (hour < 18) return 'gunduz';
  return 'aksam';
}

/** 0..1 circadian alertness; peak at local 12:00, trough at 00:00. */
export function circadianAt(now: number): number {
  const d = new Date(now);
  const hours = d.getHours() + d.getMinutes() / 60;
  return clamp01(0.5 + 0.5 * Math.sin(((hours - 6) / 24) * 2 * Math.PI));
}

export function initialState(now: number): StateVector {
  return {
    at: now,
    ...BASELINE,
    circadian: circadianAt(now),
    phase: phaseAt(now),
  };
}

/** Pulls the value toward the base with half-life decay; a negative duration means no decay. */
function decayToward(value: number, base: number, halfLife: number, elapsed: number): number {
  return clamp01(base + (value - base) * Math.pow(0.5, elapsed / halfLife));
}

export function decay(state: StateVector, now: number): StateVector {
  // If the clock is broken (NaN), decay is ignored and the previous time axis is kept.
  const clockOk = Number.isFinite(now);
  const phase = clockOk ? phaseAt(now) : state.phase;
  const elapsed = clockOk && Number.isFinite(state.at) ? Math.max(0, now - state.at) : 0;
  const fatigueBase = BASELINE.fatigue + (phase === 'gece' ? NIGHT_FATIGUE_BONUS : 0);
  return {
    at: clockOk ? now : state.at,
    cortisol: decayToward(state.cortisol, BASELINE.cortisol, HALF_LIFE_MS.cortisol, elapsed),
    dopamine: decayToward(state.dopamine, BASELINE.dopamine, HALF_LIFE_MS.dopamine, elapsed),
    serotonin: decayToward(state.serotonin, BASELINE.serotonin, HALF_LIFE_MS.serotonin, elapsed),
    // The night base is both the decay target and the lower bound: even when the
    // clock jumps back (elapsed 0), fatigue settles onto the night floor.
    fatigue: Math.max(
      fatigueBase,
      decayToward(state.fatigue, fatigueBase, HALF_LIFE_MS.fatigue, elapsed),
    ),
    circadian: clockOk ? circadianAt(now) : state.circadian,
    phase,
  };
}

export function applySignal(state: StateVector, signal: StateSignal, now: number): StateVector {
  const next: StateVector = { ...state };

  switch (signal.kind) {
    case 'error':
      next.cortisol += 0.35;
      break;
    case 'crisis_words':
      next.cortisol += 0.30;
      next.fatigue += 0.05;
      break;
    case 'tool_ok':
      next.serotonin += 0.12;
      next.dopamine += 0.08;
      break;
    case 'new_project':
      next.dopamine += 0.20;
      break;
    case 'correction':
      next.cortisol += 0.15;
      break;
    case 'turn':
      next.fatigue += 0.02;
      break;
    case 'context_bloat':
      next.fatigue += 0.10;
      break;
    case 'task_done':
      next.serotonin += 0.10;
      break;
    case 'feel':
      // A non-numeric delta is the model's corrupt output; it must not pollute the state.
      if (Number.isFinite(signal.delta)) {
        next[signal.emotion] += clamp(signal.delta, -MAX_MODEL_DELTA, MAX_MODEL_DELTA);
      }
      break;
  }

  for (const key of EMOTIONS) next[key] = clamp01(next[key]);
  if (Number.isFinite(now)) {
    next.at = now;
    next.circadian = circadianAt(now);
    next.phase = phaseAt(now);
  }
  return next;
}

/** Sampling temperature: dopamine raises it, cortisol and fatigue lower it. */
export function temperatureOf(state: StateVector): number {
  return clamp(
    0.70 + 0.35 * state.dopamine - 0.45 * state.cortisol - 0.20 * state.fatigue,
    0.10,
    1.00,
  );
}

export function gatesOf(state: StateVector): {
  crisis: boolean;
  creative: boolean;
  consolidate: boolean;
  tired: boolean;
  nightQuiet: boolean;
} {
  // Crisis is absolute: no other gate opens in the same turn, or the model gets contradictory orders.
  const crisis = state.cortisol >= 0.70;
  return {
    crisis,
    creative: !crisis && state.dopamine >= 0.70,
    consolidate: !crisis && state.serotonin >= 0.70,
    tired: !crisis && state.fatigue >= 0.75,
    nightQuiet: !crisis && state.phase === 'gece' && state.fatigue >= 0.60,
  };
}

export function statePromptBlock(state: StateVector): string {
  const gates = gatesOf(state);
  const lines = [
    '## Internal state (automatic, refreshed every turn)',
    `cortisol ${state.cortisol.toFixed(2)} · dopamine ${state.dopamine.toFixed(2)} · serotonin ${state.serotonin.toFixed(2)} · fatigue ${state.fatigue.toFixed(2)} · phase: ${state.phase} · temperature ${temperatureOf(state).toFixed(2)}`,
  ];
  if (gates.crisis) lines.push('Mode: CRISIS. No jokes, no decoration. Write only diagnosis, command and fix.');
  if (gates.creative) lines.push('Mode: R&D. Offer at most 2 short proactive engineering suggestions.');
  if (gates.consolidate) lines.push('Mode: Consolidation. Refactor and test suggestions come first.');
  if (gates.tired) lines.push('Mode: Tired. Context is muddled; suggest sleep + distillation to the user.');
  if (gates.nightQuiet) lines.push('Mode: Night. Answer briefly, calmly and thoughtfully.');
  return lines.join('\n');
}
