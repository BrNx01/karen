/**
 * Provider registry: most providers OpenCode supports speak the
 * OpenAI-compatible protocol, so one adapter plus a registry is enough.
 * Only Anthropic and Google have their own protocols.
 */
export type ProviderKind = 'anthropic' | 'openai' | 'google';

export type ProviderSpec = {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Base address for OpenAI/Google-compatible providers. */
  baseUrl?: string;
  /** Environment variable the key is read from. */
  apiKeyEnv?: string;
  /** Is a key required (local models need none). */
  requiresKey: boolean;
  local: boolean;
  /** Short note shown on the settings card. */
  hint?: string;
  /** Providers that need extra fields, like Google. */
  extra?: ('apiVersion' | 'deployment' | 'baseUrl')[];
};

export const PROVIDERS: ProviderSpec[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    requiresKey: false,
    local: true,
    hint: 'local · no key',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    requiresKey: false,
    local: true,
    hint: 'local · no key',
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8080/v1',
    requiresKey: false,
    local: true,
    hint: 'local · no key',
  },
  {
    id: 'vllm',
    label: 'vLLM',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    requiresKey: false,
    local: true,
    hint: 'local · no key',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    requiresKey: true,
    local: false,
    hint: 'Claude models',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    requiresKey: true,
    local: false,
    hint: 'GPT models',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GOOGLE_API_KEY',
    requiresKey: true,
    local: false,
    hint: 'Gemini models',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    requiresKey: true,
    local: false,
    hint: 'fast inference',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    kind: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    requiresKey: true,
    local: false,
    hint: 'very fast inference',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    requiresKey: true,
    local: false,
    hint: 'economical',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    requiresKey: true,
    local: false,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    requiresKey: true,
    local: false,
    hint: 'one key, many models',
  },
  {
    id: 'together',
    label: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    requiresKey: true,
    local: false,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    requiresKey: true,
    local: false,
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    kind: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    requiresKey: true,
    local: false,
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    kind: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
    requiresKey: true,
    local: false,
    hint: 'with web search',
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    kind: 'openai',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
    requiresKey: true,
    local: false,
    hint: 'endpoint + deployment name',
    extra: ['baseUrl', 'apiVersion', 'deployment'],
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI compatible)',
    kind: 'openai',
    requiresKey: false,
    local: false,
    hint: 'your own endpoint',
    extra: ['baseUrl'],
  },
];

export function provider(id: string): ProviderSpec | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Summary shown on the settings cards (key values are hidden). */
export function providerList(configured: Record<string, boolean>): {
  id: string;
  label: string;
  hint: string;
  local: boolean;
  requiresKey: boolean;
  configured: boolean;
}[] {
  return PROVIDERS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    hint: spec.hint ?? (spec.local ? 'yerel' : 'bulut'),
    local: spec.local,
    requiresKey: spec.requiresKey,
    configured: configured[spec.id] === true,
  }));
}
