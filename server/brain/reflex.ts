/** Amygdala reflex: the decision taken before any model call. Pure; no clock, no IO. */

export const RAM_KILL_RATIO = 0.9;
export const REPEAT_LIMIT = 3;
/** Repeats count only for side-effecting tools; read tools never trigger. */
export const REFLEX_TOOLS: ReadonlySet<string> = new Set([
  'run_command',
  'write_file',
  'edit_file',
  'open_app',
  'clipboard_write',
  'spawn_session',
]);

export type ReflexInput = {
  rssMb: number;
  totalMb: number;
  /** Same tool+argument signature back to back in the session. */
  repeats: number;
  tool: string;
};

export type ReflexVerdict =
  | { action: 'none' }
  | { action: 'kill-oldest'; reason: string }
  | { action: 'abort-session'; reason: string };

export function assess(input: ReflexInput): ReflexVerdict {
  const ratio = clampRatio(input.rssMb, input.totalMb);
  if (ratio >= RAM_KILL_RATIO) {
    return { action: 'kill-oldest', reason: `RAM %${Math.round(ratio * 100)} (eşik %90)` };
  }
  if (REFLEX_TOOLS.has(input.tool) && input.repeats >= REPEAT_LIMIT) {
    return {
      action: 'abort-session',
      reason: `${input.tool} aynı argümanla ${input.repeats} kez üst üste çağrıldı`,
    };
  }
  return { action: 'none' };
}

/** 0 if unmeasurable: no intervention. The ratio is clipped to 1 (an overflowing counter must not print a wrong percentage). */
function clampRatio(rssMb: number, totalMb: number): number {
  if (!Number.isFinite(rssMb) || !Number.isFinite(totalMb) || totalMb <= 0 || rssMb < 0) return 0;
  return Math.min(rssMb / totalMb, 1);
}

/** Argument keys are sorted: the same call in a different order is not a different signature. */
export function signature(tool: string, args: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) sorted[key] = args[key];
  return `${tool}\u0000${JSON.stringify(sorted)}`;
}
