import type { Provider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

export { AnthropicProvider } from './anthropic.js';
export { OpenAICompatibleProvider } from './openai-compatible.js';
export { FakeProvider } from './fake.js';
export { parseSSE } from './sse.js';

/**
 * `anthropic`, `openai`, `ollama` (http://127.0.0.1:11434/v1),
 * `lmstudio` (http://127.0.0.1:1234/v1) or a baseUrl directly.
 */
export function createProvider(id: string, env: NodeJS.ProcessEnv): Provider {
  if (id === 'anthropic') {
    const apiKey = env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new Error('missing API key: ANTHROPIC_API_KEY');
    return new AnthropicProvider({ apiKey, baseUrl: env['ANTHROPIC_BASE_URL'] });
  }
  if (id === 'openai') {
    const apiKey = env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('missing API key: OPENAI_API_KEY');
    return new OpenAICompatibleProvider({
      name: 'openai',
      apiKey,
      baseUrl: env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1',
    });
  }
  if (id === 'ollama') {
    return new OpenAICompatibleProvider({ name: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' });
  }
  if (id === 'lmstudio') {
    return new OpenAICompatibleProvider({ name: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' });
  }
  if (/^https?:\/\//.test(id)) {
    return new OpenAICompatibleProvider({ baseUrl: id, apiKey: env['OPENAI_API_KEY'] });
  }
  throw new Error(`unknown provider: ${id}`);
}
