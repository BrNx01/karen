import { PROVIDERS, type ProviderKind } from './registry.js';

export type ProbeModel = { id: string; context?: number };

export type ProbeResult =
  | { ok: true; kind: ProviderKind; providerId: string; address: string; models: ProbeModel[] }
  | { ok: false; error: string };

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

/**
 * Accepts what people actually paste: a bare host, a host with a path, a trailing
 * slash, or a full URL. `https` is assumed unless the host is clearly local.
 */
export function normaliseAddress(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `${isLocal(trimmed) ? 'http' : 'https'}://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

function hostOf(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    return '';
  }
}

function isLocal(value: string): boolean {
  const host = hostOf(value) || value.split('/')[0]?.split(':')[0] || '';
  return LOCAL_HOSTS.test(host) || host.toLowerCase().endsWith('.local');
}

/** Which protocol a host speaks. This is what decides which adapter is built. */
export function inferKind(address: string): ProviderKind {
  const host = hostOf(address).toLowerCase();
  if (host.includes('anthropic')) return 'anthropic';
  if (host.includes('generativelanguage.googleapis') || host.includes('googleapis')) return 'google';
  return 'openai';
}

/** A known preset when the address matches one, otherwise a per-host custom id. */
export function providerIdFor(address: string): string {
  const normalised = normaliseAddress(address);
  const host = hostOf(normalised).toLowerCase();
  const preset = PROVIDERS.find((spec) => {
    if (!spec.baseUrl) return false;
    const presetHost = hostOf(spec.baseUrl).toLowerCase();
    return presetHost !== '' && presetHost === host;
  });
  if (preset) return preset.id;
  return `custom:${host}`;
}

/** The id a secret is stored under: `custom:my.host` keeps its key under `custom`. */
export function secretIdFor(providerId: string): string {
  return providerId.split(':')[0] ?? providerId;
}

/**
 * Reads a model list from the shape each protocol actually returns, and takes the
 * context window from whichever field the endpoint chose to send.
 */
export function parseModelList(kind: ProviderKind, body: unknown): ProbeModel[] {
  if (body === null || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;

  const rows = Array.isArray(record['data'])
    ? record['data']
    : Array.isArray(record['models'])
      ? record['models']
      : [];

  const out: ProbeModel[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;

    // Google returns name: "models/gemini-2.0-flash"; the others use id.
    const rawId = typeof item['id'] === 'string' ? item['id'] : typeof item['name'] === 'string' ? item['name'] : '';
    const id = rawId.replace(/^models\//, '');
    if (id === '') continue;

    const context = firstNumber(item['context_length'], item['context_window'], item['max_context_length'], item['inputTokenLimit'], nested(item['top_provider'], 'context_length'));
    out.push(context === undefined ? { id } : { id, context });
  }
  return out;
}

function nested(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[key];
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

/** The list endpoint and auth header differ per protocol; everything else is shared. */
function requestFor(kind: ProviderKind, address: string, key: string): { url: string; headers: Record<string, string> } {
  const base = normaliseAddress(address);
  if (kind === 'anthropic') {
    return {
      url: `${base}/models`,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    };
  }
  if (kind === 'google') {
    return { url: `${base}/models?key=${encodeURIComponent(key)}`, headers: {} };
  }
  return {
    url: `${base}/models`,
    headers: key === '' ? {} : { authorization: `Bearer ${key}` },
  };
}

/**
 * Asks the endpoint which models it serves. Failures come back as readable text —
 * an HTML page or an empty body must never look like "no models".
 */
export async function probeProvider(opts: {
  address: string;
  key?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const address = normaliseAddress(opts.address);
  if (address === '') return { ok: false, error: 'address is empty' };

  const kind = inferKind(address);
  const providerId = providerIdFor(address);
  const { url, headers } = requestFor(kind, address, opts.key ?? '');
  const doFetch = opts.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `could not reach ${url}: ${message}` };
  }

  const text = await response.text().catch(() => '');

  if (!response.ok) {
    // Providers put the useful sentence in `error.message`; fall back to the raw body.
    let detail = '';
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      detail = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? '');
    } catch {
      detail = text.slice(0, 200);
    }
    return { ok: false, error: `${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`.trim() };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // A 200 that is not JSON is a proxy, a wrong path, or an HTML error page.
    return { ok: false, error: `${url} answered with ${response.status} but not JSON (is /v1 missing from the address?)` };
  }

  const models = parseModelList(kind, body);
  if (models.length === 0) {
    return { ok: false, error: `${url} returned no models for this key` };
  }

  return { ok: true, kind, providerId, address, models };
}
