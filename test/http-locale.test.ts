import { describe, it, expect } from 'vitest';
import { errorBody, message, requestLocale } from '../server/http/locale.js';

describe('requestLocale', () => {
  it('honours a supported header', () => {
    expect(requestLocale('tr', 'en')).toBe('tr');
    expect(requestLocale('en', 'tr')).toBe('en');
  });

  it('falls back for a missing or unknown header', () => {
    expect(requestLocale(undefined, 'tr')).toBe('tr');
    expect(requestLocale('zz', 'en')).toBe('en');
    expect(requestLocale(['tr', 'en'], 'en')).toBe('tr');
    expect(requestLocale([], 'tr')).toBe('tr');
  });
});

describe('errorBody', () => {
  it('keeps a stable code and localises the sentence', () => {
    const tr = errorBody('tr', 'server.notFound');
    const en = errorBody('en', 'server.notFound');
    expect(tr.error).toBe('notFound');
    expect(tr.error).toBe(en.error);
    expect(tr.message).not.toBe(en.message);
    expect(tr.message).toBe('Bulunamadı');
    expect(en.message).toBe('Not found');
  });

  it('covers every server key with both languages', () => {
    const keys = ['server.unauthorized', 'server.invalidJson', 'server.bodyTooLarge', 'server.unknownSession'] as const;
    for (const key of keys) {
      expect(errorBody('tr', key).message).not.toBe('');
      expect(errorBody('en', key).message).not.toBe('');
      expect(errorBody('tr', key).error).toMatch(/^[a-zA-Z]+$/);
    }
  });
});

describe('message', () => {
  it('interpolates and switches language', () => {
    expect(message('en', 'inbox.unread', { count: 4 })).toContain('4');
    expect(message('tr', 'inbox.unread', { count: 4 })).toContain('4');
    expect(message('en', 'inbox.unread', { count: 4 })).not.toBe(message('tr', 'inbox.unread', { count: 4 }));
  });
});
