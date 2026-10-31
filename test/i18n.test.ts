import { describe, it, expect } from 'vitest';
import { dictionaries, isLocaleSetting, resolveLocale, translate } from '../shared/i18n/index.js';

describe('resolveLocale', () => {
  it('auto follows Turkish OS tags', () => {
    expect(resolveLocale('auto', 'tr-TR')).toBe('tr');
    expect(resolveLocale('auto', 'tr')).toBe('tr');
    expect(resolveLocale('auto', 'TR-tr')).toBe('tr');
    expect(resolveLocale('auto', '  tr-CY ')).toBe('tr');
  });

  it('auto falls back to english', () => {
    expect(resolveLocale('auto', 'en-US')).toBe('en');
    expect(resolveLocale('auto', 'de-DE')).toBe('en');
    expect(resolveLocale('auto', undefined)).toBe('en');
    expect(resolveLocale('auto', '')).toBe('en');
    // `tr` must match as a subtag, not as a prefix of another language.
    expect(resolveLocale('auto', 'ts-ZA')).toBe('en');
  });

  it('an explicit setting wins over the OS', () => {
    expect(resolveLocale('en', 'tr-TR')).toBe('en');
    expect(resolveLocale('tr', 'en-US')).toBe('tr');
  });
});

describe('dictionary completeness', () => {
  it('both languages define every key', () => {
    expect(Object.keys(dictionaries.tr).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it('no value is an empty string', () => {
    for (const [locale, dict] of Object.entries(dictionaries)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(`${locale}:${key}:${value.trim()}`).not.toBe(`${locale}:${key}:`);
      }
    }
  });

  it('placeholders match between languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(dictionaries.en) as (keyof typeof dictionaries.en)[]) {
      expect(`${key}:${vars(dictionaries.tr[key])}`).toBe(`${key}:${vars(dictionaries.en[key])}`);
    }
  });
});

describe('translate', () => {
  it('interpolates placeholders', () => {
    expect(translate('en', 'inbox.summary', { notes: 3, suggestions: 1 })).toContain('3');
    expect(translate('tr', 'inbox.summary', { notes: 3, suggestions: 1 })).toContain('3');
  });

  it('leaves an unknown placeholder visible', () => {
    expect(translate('en', 'inbox.summary', {})).toContain('{notes}');
  });

  it('switches language for the same key', () => {
    expect(translate('en', 'memory.title')).toBe('Memory');
    expect(translate('tr', 'memory.title')).toBe('Hafıza');
    expect(translate('en', 'memory.title')).not.toBe(translate('tr', 'memory.title'));
  });

  it('a number renders as digits', () => {
    expect(translate('en', 'common.notes', { count: 7 })).toBe('7 notes');
  });
});

describe('isLocaleSetting', () => {
  it('accepts the three values only', () => {
    expect(isLocaleSetting('auto')).toBe(true);
    expect(isLocaleSetting('tr')).toBe(true);
    expect(isLocaleSetting('en')).toBe(true);
    expect(isLocaleSetting('de')).toBe(false);
    expect(isLocaleSetting('')).toBe(false);
    expect(isLocaleSetting(undefined)).toBe(false);
  });
});
