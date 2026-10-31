import { describe, it, expect } from 'vitest';
import { evidenceCheck } from '../server/memory/distill.js';
import type { DistillBlock } from '../server/memory/distill.js';
import type { StoredEvent } from '../server/store/events.js';

function block(text: string): DistillBlock {
  const event = {
    id: 5, ts: 1, kind: 'tool_result', actor: 'system', sessionId: 's',
    payload: { tool: 'web_search', ok: true }, hash: 'h', prevHash: 'p', body: text,
  } as StoredEvent;
  return { sessionId: 's', events: [event], userText: '' };
}

const candidate = (text: string) => ({ kind: 'semantic' as const, text, concepts: [], evidence: [5], base: 0.4 });

describe('URL evidence gate', () => {
  it('a URL from the tool result is accepted', () => {
    const b = block('sonuç: https://example.com/a derleyici hızlandırma üzerine');
    expect(evidenceCheck(candidate('derleyici https://example.com/a hızlandırma'), b)).toBeNull();
  });

  it('a fabricated URL is rejected', () => {
    const b = block('sonuç: https://example.com/a derleyici hızlandırma üzerine');
    const out = evidenceCheck(candidate('derleyici https://uydurma.test/x hızlandırma'), b);
    expect(out?.reason).toBe('source url missing');
  });

  it('the old rule applies when no URL is present', () => {
    const b = block('kullanıcı türkçe sever');
    expect(evidenceCheck(candidate('kullanıcı türkçe sever'), b)).toBeNull();
  });

  it('a trailing period does not break the URL match', () => {
    const b = block('sonuç: https://example.com/a derleyici hızlandırma üzerine');
    expect(evidenceCheck(candidate('derleyici hızlandırma. Kaynak: https://example.com/a.'), b)).toBeNull();
  });

  it('a URL inside markdown brackets is accepted', () => {
    const b = block('sonuç: https://example.com/a derleyici hızlandırma üzerine');
    expect(evidenceCheck(candidate('[başlık](https://example.com/a) derleyici hızlandırma'), b)).toBeNull();
  });

  it('a prefix of a longer URL is not accepted', () => {
    const b = block('sonuç: https://example.com/abc derleyici hızlandırma üzerine');
    const out = evidenceCheck(candidate('derleyici https://example.com/a hızlandırma'), b);
    expect(out?.reason).toBe('source url missing');
  });

  it('a real URL ending with a paren matches exactly', () => {
    const b = block('sonuç: https://w.test/Foo_(bar) sayfa hakkında bilgi');
    expect(evidenceCheck(candidate('sayfa https://w.test/Foo_(bar) hakkında bilgi'), b)).toBeNull();
  });
});
