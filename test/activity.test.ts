import { describe, it, expect } from 'vitest';
import { IdleClock, greetingLine, shouldGreet } from '../server/autonomy/activity.js';

const NOON = new Date(2026, 2, 10, 12, 0, 0).getTime();

function setup() {
  let clock = NOON;
  const idle = new IdleClock(() => clock);
  return { idle, adv: (ms: number) => (clock += ms) };
}

describe('IdleClock', () => {
  it('new meter is not counted as idle', () => {
    const { idle } = setup();
    expect(idle.idleMs()).toBe(0);
    expect(idle.isIdle(30)).toBe(false);
  });

  it('becomes idle once the threshold is exceeded', () => {
    const { idle, adv } = setup();
    adv(31 * 60_000);
    expect(idle.isIdle(30)).toBe(true);
  });

  it('touch resets the idle counter', () => {
    const { idle, adv } = setup();
    adv(60 * 60_000);
    idle.touch();
    expect(idle.idleMs()).toBe(0);
    expect(idle.isIdle(30)).toBe(false);
  });

  it('wasIdle flag is consumed once', () => {
    const { idle, adv } = setup();
    adv(45 * 60_000);
    expect(idle.wasIdle(30)).toBe(true);
    expect(idle.wasIdle(30)).toBe(false);
  });

  it('a return after a short break is not a greeting', () => {
    const { idle, adv } = setup();
    adv(5 * 60_000);
    idle.touch();
    expect(idle.wasIdle(30)).toBe(false);
  });

  it('greeting eligibility is kept after the return', () => {
    const { idle, adv } = setup();
    adv(60 * 60_000);
    idle.touch(); // kullanıcı geri geldi
    expect(idle.wasIdle(30)).toBe(true); // ayrılık hâlâ karşılama hakkı
    expect(idle.wasIdle(30)).toBe(false);
  });

  it('a second absence re-arms the greeting', () => {
    const { idle, adv } = setup();
    adv(45 * 60_000);
    expect(idle.wasIdle(30)).toBe(true);
    idle.touch();
    expect(idle.wasIdle(30)).toBe(false);
    adv(45 * 60_000);
    expect(idle.wasIdle(30)).toBe(true);
  });

  it('a backwards clock never yields a negative elapsed time', () => {
    const { idle, adv } = setup();
    adv(-60 * 60_000);
    expect(idle.idleMs()).toBe(0);
  });
});

describe('greeting', () => {
  it('no greeting without an absence', () => {
    expect(shouldGreet(false, 5)).toBe(false);
  });

  it('no greeting without unread notes', () => {
    expect(shouldGreet(true, 0)).toBe(false);
    expect(greetingLine(0, 0)).toBeNull();
  });

  it('absence plus note yields a single greeting line', () => {
    expect(shouldGreet(true, 3)).toBe(true);
    const line = greetingLine(3, 1);
    expect(line).toBe('While you were away: 3 new notes, 1 suggestions.');
    expect(line).toContain('3');
    expect(line).toContain('1');
    // Single sentence: only a trailing period.
    expect(line!.split('.').filter((part) => part.trim() !== '')).toHaveLength(1);
  });
});
