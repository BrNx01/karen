import { describe, it, expect } from 'vitest';
import { localeTag, osLocaleTag } from '../app/src/locale.js';

describe('osLocaleTag', () => {
  it('prefers the primary language', () => {
    expect(osLocaleTag({ language: 'tr-TR', languages: ['tr-TR', 'en-US'] })).toBe('tr-TR');
  });

  it('falls back to the first entry', () => {
    expect(osLocaleTag({ languages: ['de-DE'] })).toBe('de-DE');
  });

  it('is undefined when nothing is known', () => {
    expect(osLocaleTag({})).toBeUndefined();
    expect(osLocaleTag({ language: '', languages: [] })).toBeUndefined();
  });
});

describe('localeTag', () => {
  it('maps to a BCP-47 tag for formatting', () => {
    expect(localeTag('tr')).toBe('tr-TR');
    expect(localeTag('en')).toBe('en-US');
  });
});
