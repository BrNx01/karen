import type { Delta, Provider, StreamRequest } from './types.js';

/**
 * Makes the provider swappable at runtime: when settings are saved,
 * the new model takes effect without restarting sessions.
 */
export class SwitchableProvider implements Provider {
  private current: Provider;
  private model: string;

  constructor(initial: Provider, model: string) {
    this.current = initial;
    this.model = model;
  }

  get name(): string {
    return this.current.name;
  }

  get activeModel(): string {
    return this.model;
  }

  swap(provider: Provider, model: string): void {
    this.current = provider;
    this.model = model;
  }
  stream(req: StreamRequest): AsyncIterable<Delta> {
    // The model name comes from settings, unless the session overrides its own model.
    return this.current.stream(req.model === 'default' ? { ...req, model: this.model } : req);
  }
}

export { buildProvider, PROVIDERS, providerList, providerSpec } from './providers/build.js';
export type { BuiltProvider, ProviderSpec } from './providers/build.js';
