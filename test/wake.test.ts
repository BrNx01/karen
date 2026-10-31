import { describe, it, expect } from 'vitest';
import { isWakePhrase, isFatalWakeError, wakeErrorText } from '../app/src/wake.js';

describe('wake phrase', () => {
  it('catches "hey karen" and its Turkish mis-hearings', () => {
    expect(isWakePhrase('hey karen')).toBe(true);
    expect(isWakePhrase('Hey Karen, what time is it')).toBe(true);
    expect(isWakePhrase('hej keren')).toBe(true);
    expect(isWakePhrase('hey karın')).toBe(true);
    expect(isWakePhrase('selam hey karen naber')).toBe(true);
  });

  it('does not catch the retired name', () => {
    expect(isWakePhrase('hey zero')).toBe(false);
    expect(isWakePhrase('hej sıfır')).toBe(false);
  });

  it('does not catch an unrelated sentence', () => {
    expect(isWakePhrase('karen bugün gelmedi')).toBe(false);
    expect(isWakePhrase('heyecanlı')).toBe(false);
    expect(isWakePhrase('merhaba')).toBe(false);
  });

  it('separates permanent errors (no infinite retry)', () => {
    expect(isFatalWakeError('not-allowed')).toBe(true);
    expect(isFatalWakeError('service-not-allowed')).toBe(true);
    expect(isFatalWakeError('audio-capture')).toBe(true);
    expect(isFatalWakeError('network')).toBe(false);
  });

  it('returns a readable error message', () => {
    expect(wakeErrorText('not-allowed')).toContain('microphone permission');
    expect(wakeErrorText('audio-capture')).toContain('Microphone not found');
  });

  it('uses the translator when one is supplied', () => {
    const t = (key: string) => `T:${key}`;
    expect(wakeErrorText('audio-capture', t as never)).toBe('T:wake.noMic');
  });
});
