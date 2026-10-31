/**
 * Idle clock.
 *
 * Deliberately dumb: it only knows "someone said there was activity, here is the time".
 * The UI's 5 s polling never touches this — if it did, "idle" would never be reached.
 * No timer; the caller owns the timer.
 */
export class IdleClock {
  private lastAt: number;
  private awayMs = 0;
  private greeted = false;

  constructor(private readonly now: () => number) {
    this.lastAt = now();
  }

  touch(): void {
    const t = this.now();
    // An absence whose greeting was already consumed is not counted again on the next touch.
    this.awayMs = this.greeted ? 0 : Math.max(0, t - this.lastAt);
    this.greeted = false;
    this.lastAt = t;
  }

  idleMs(): number {
    return Math.max(0, this.now() - this.lastAt); // the clock can go backwards
  }

  isIdle(minutes: number): boolean {
    return this.idleMs() > minutes * 60_000;
  }

  /** Returns true once if the absence crossed the threshold; the flag is consumed. */
  // One threshold, one consumer.
  wasIdle(minutes: number): boolean {
    const threshold = minutes * 60_000;
    if (this.greeted) return false;
    if (this.idleMs() <= threshold && this.awayMs <= threshold) return false;
    this.greeted = true;
    return true;
  }
}

/** A greeting happens only if there really was an absence and there are accumulated notes. */
export function shouldGreet(wasIdle: boolean, unread: number): boolean {
  return wasIdle && unread > 0;
}

/** One-line morning summary; no notes means no line. Localised at the call site's locale. */
export function greetingLine(unread: number, suggestions: number, text?: string): string | null {
  if (unread <= 0) return null;
  return text ?? `While you were away: ${unread} new notes, ${suggestions} suggestions.`;
}
