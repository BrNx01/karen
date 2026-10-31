import type { Provider } from '../engine/types.js';
import { createProvider } from '../engine/providers/index.js';
import type { Distiller } from './distill.js';

/** Wraps the provider as a single-prompt bridge for distillation. */
export function providerDistiller(provider: Provider, model: string): Distiller {
  return async (prompt: string): Promise<string> => {
    let text = '';
    for await (const delta of provider.stream({
      model,
      messages: [{ role: 'user', content: prompt }],
      tools: [],
    })) {
      if (delta.type === 'text') text += delta.text;
    }
    return text;
  };
}

/**
 * Wires a provider for sleep. A local model (ollama/lmstudio/localhost) is
 * usable by default; a paid provider only kicks in with explicit approval
 * (KAREN_SLEEP_ALLOW_PAID=1) — spec §7.14: no spending without permission.
 */
export function sleepDistiller(
  env: NodeJS.ProcessEnv,
  injected?: Provider,
  model = 'default',
): Distiller | undefined {
  if (injected) return providerDistiller(injected, model);

  const id = env['KAREN_PROVIDER'] ?? 'ollama';
  const isLocal = id === 'ollama' || id === 'lmstudio' || /^https?:\/\/(127\.0\.0\.1|localhost)/.test(id);
  if (!isLocal && env['KAREN_SLEEP_ALLOW_PAID'] !== '1') return undefined;

  try {
    return providerDistiller(createProvider(id, env), model);
  } catch {
    return undefined;
  }
}
