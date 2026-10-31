import { describe, it, expect } from 'vitest';
import { sleepDistiller } from '../server/memory/distiller.js';
import { FakeProvider } from '../server/engine/providers/fake.js';

describe('uyku modeli izni', () => {
  it('the local provider is usable without permission', () => {
    expect(sleepDistiller({ KAREN_PROVIDER: 'ollama' })).toBeDefined();
    expect(sleepDistiller({ KAREN_PROVIDER: 'lmstudio' })).toBeDefined();
    expect(sleepDistiller({ KAREN_PROVIDER: 'http://127.0.0.1:8080/v1' })).toBeDefined();
  });

  it('a paid provider is not built without permission', () => {
    expect(sleepDistiller({ KAREN_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })).toBeUndefined();
    expect(sleepDistiller({ KAREN_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })).toBeUndefined();
  });

  it('a paid provider is built with explicit permission', () => {
    expect(
      sleepDistiller({ KAREN_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', KAREN_SLEEP_ALLOW_PAID: '1' }),
    ).toBeDefined();
  });

  it('the injected provider is always used', () => {
    const provider = new FakeProvider([[{ type: 'done', stopReason: 'end' }]]);
    expect(sleepDistiller({}, provider)).toBeDefined();
  });
});
