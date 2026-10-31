import type { Provider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { provider as specOf, type ProviderSpec } from './registry.js';
import type { Settings } from '../../settings.js';

export type BuiltProvider = { provider: Provider; label: string; spec: ProviderSpec };

/**
 * Builds the provider from settings. Without a key it falls back to the local model
 * (the app does not fail to start) and says so through `label`.
 */
export function buildProvider(
  settings: Settings,
  apiKey: (id: string) => string | undefined,
): BuiltProvider {
  const spec = specOf(settings.provider) ?? (specOf('ollama') as ProviderSpec);
  const key = apiKey(spec.id) ?? (spec.apiKeyEnv ? process.env[spec.apiKeyEnv] : undefined);
  const perProvider = settings.providers?.[spec.id];

  if (spec.requiresKey && !key) return fallback(spec);

  if (spec.kind === 'anthropic') {
    return { provider: new AnthropicProvider({ apiKey: key as string }), label: 'anthropic', spec };
  }

  if (spec.kind === 'google') {
    return {
      provider: new GoogleProvider({
        apiKey: key as string,
        ...(perProvider?.baseUrl ? { baseUrl: perProvider.baseUrl } : {}),
      }),
      label: 'google',
      spec,
    };
  }

  // OpenAI-compatible: base URL from settings, otherwise from the registry.
  let baseUrl = perProvider?.baseUrl?.trim() || settings.baseUrl.trim() || spec.baseUrl || '';
  if (spec.id === 'azure-openai') {
    const deployment = perProvider?.deployment ?? settings.model;
    const apiVersion = perProvider?.apiVersion ?? '2024-10-21';
    if (!baseUrl || !deployment) return fallback(spec, 'azure adresi/dağıtımı eksik');
    baseUrl = `${baseUrl.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}?api-version=${encodeURIComponent(apiVersion)}`;
  }
  if (baseUrl === '') return fallback(spec, 'base URL eksik');

  return {
    provider: new OpenAICompatibleProvider({
      name: spec.id,
      baseUrl,
      ...(key ? { apiKey: key } : {}),
    }),
    label: spec.label,
    spec,
  };
}

function fallback(spec: ProviderSpec, why?: string): BuiltProvider {
  const ollama = specOf('ollama') as ProviderSpec;
  return {
    provider: new OpenAICompatibleProvider({ name: 'ollama', baseUrl: ollama.baseUrl as string }),
    label: `${spec.label} → yerel${why ? ` (${why})` : ' (anahtar yok)'}`,
    spec: ollama,
  };
}

export { PROVIDERS, providerList, provider as providerSpec } from './registry.js';
export type { ProviderSpec } from './registry.js';
