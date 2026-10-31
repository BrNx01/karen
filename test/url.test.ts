import { describe, it, expect } from 'vitest';
import { buildApiUrl } from '../app/src/url.js';

describe('buildApiUrl', () => {
  it('appends the token', () => {
    expect(buildApiUrl('/api/memory', 'abc')).toBe('/api/memory?token=abc');
  });

  it('mevcut sorgu parametrelerini korur', () => {
    const url = buildApiUrl('/api/memory?q=yedek&dormant=1', 'abc');
    expect(url.startsWith('/api/memory?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('q')).toBe('yedek');
    expect(params.get('dormant')).toBe('1');
    expect(params.get('token')).toBe('abc');
  });

  it('adds nothing when the token is empty', () => {
    expect(buildApiUrl('/api/health', '')).toBe('/api/health');
  });

  it('encodes special characters', () => {
    const url = buildApiUrl('/api/memory?q=Türkçe rapor', 'a b');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('q')).toBe('Türkçe rapor');
    expect(params.get('token')).toBe('a b');
  });

  it('produces no broken concatenation', () => {
    // regression: it used to produce `/api/memory&q=x?token=y`.
    expect(buildApiUrl('/api/memory?q=x', 't')).not.toContain('&q=x?');
  });
});
