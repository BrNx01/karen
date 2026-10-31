import { describe, it, expect } from 'vitest';
import { trimHistory } from '../../server/engine/history.js';

describe('trimHistory', () => {
  it('keeps the system message and the last turn', () => {
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'a'.repeat(100) },
      { role: 'assistant' as const, content: 'b'.repeat(100) },
      { role: 'user' as const, content: 'son' },
    ];
    const out = trimHistory(msgs, 150);
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out.at(-1)).toEqual({ role: 'user', content: 'son' });
    expect(out.some((m) => m.content.includes('trimmed'))).toBe(false);
  });

  it('drops old turns over budget and adds a note', () => {
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'a'.repeat(1000) },
      { role: 'assistant' as const, content: 'b'.repeat(1000) },
      { role: 'user' as const, content: 'yeni' },
      { role: 'assistant' as const, content: 'cevap' },
    ];
    const out = trimHistory(msgs, 500);
    expect(out[0]?.role).toBe('system');
    expect(out.some((m) => m.content.startsWith('[previous'))).toBe(true);
    expect(out.at(-1)?.content).toBe('cevap');
  });
});
