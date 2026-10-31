import { describe, it, expect } from 'vitest';
import { FakeProvider } from '../../server/engine/providers/fake.js';

describe('FakeProvider', () => {
  it('emits deltas and records requests', async () => {
    const p = new FakeProvider([[{ type: 'text', text: 'merhaba' }, { type: 'done', stopReason: 'end' }]]);
    const seen: string[] = [];
    for await (const d of p.stream({ model: 'm', messages: [], tools: [] })) {
      if (d.type === 'text') seen.push(d.text);
    }
    expect(seen).toEqual(['merhaba']);
    expect(p.calls).toHaveLength(1);
  });
});
