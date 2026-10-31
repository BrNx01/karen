import type { Tool } from './types.js';
import { MAX_OUTPUT, truncate } from './types.js';

const TIMEOUT_MS = 20_000;

/** Extracts search-result links with a regex; no HTML parser dependency. */
function parseResults(html: string, limit: number): { title: string; url: string; snippet: string }[] {
  const out: { title: string; url: string; snippet: string }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const cls = /class="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const body = decodeEntities(tag.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    if (cls.includes('result__snippet')) {
      const last = out[out.length - 1];
      if (last && last.snippet === '') last.snippet = body;
      continue;
    }
    if (!cls.includes('result__a')) continue;
    const href = /href="([^"]+)"/i.exec(tag)?.[1];
    if (!href) continue;
    out.push({ title: body, url: resolveHref(decodeEntities(href)), snippet: '' });
    if (out.length >= limit) break;
  }
  return out;
}

/** Converts a DuckDuckGo redirect link to the real address. */
function resolveHref(href: string): string {
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  try {
    const parsed = new URL(absolute);
    return parsed.searchParams.get('uddg') ?? absolute;
  } catch {
    return absolute;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function webSearchTool(opts: { fetchImpl?: typeof fetch } = {}): Tool {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    access: 'read',
    def: {
      name: 'web_search',
      description: 'Performs a web search; each result comes back as a title and URL on one line.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Maximum number of results (default 5)' },
        },
        required: ['query'],
      },
    },
    async run(args, ctx) {
      const query = String(args['query'] ?? '').trim();
      if (query === '') return { ok: false, output: 'query is empty' };
      const limit = Math.min(10, Math.max(1, Math.floor(Number(args['limit'])) || 5));
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const signal = AbortSignal.any([ctx.signal, timeout]);
      let text = '';
      try {
        const res = await doFetch(url, { signal, redirect: 'follow' });
        if (!res.ok) {
          // The error body is not read: release the socket.
          await res.body?.cancel().catch(() => undefined);
          return { ok: false, output: `search failed: HTTP ${res.status}` };
        }
        // The whole body is not read into memory: reading stops once the limit is full.
        if (res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (text.length >= MAX_OUTPUT) {
              await reader.cancel().catch(() => undefined);
              break;
            }
          }
        } else {
          text = await res.text();
        }
      } catch (err) {
        const message = signal.aborted ? 'aborted or timed out' : (err as Error).message;
        return { ok: false, output: `search failed: ${message}` };
      }
      const results = parseResults(text, limit);
      if (results.length === 0) return { ok: false, output: 'no results found' };
      const lines = results.map((r) => `- ${r.title} — ${r.url}${r.snippet ? ` (${r.snippet})` : ''}`);
      return { ok: true, output: truncate(lines.join('\n')) };
    },
  };
}

export function fetchUrlTool(opts: { readOnly?: boolean; fetchImpl?: typeof fetch } = {}): Tool {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    access: 'exec',
    def: {
      name: 'fetch_url',
      description: 'Makes an HTTP(S) request and returns the body (limited to 32 KiB).',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http or https address' },
          method: { type: 'string', description: 'Default GET' },
          body: { type: 'string', description: 'Request body' },
        },
        required: ['url'],
      },
    },
    async run(args, ctx) {
      const raw = String(args['url'] ?? '');
      // Autonomous mode only reads: a request with a body or anything other than GET/HEAD never leaves the machine.
      if (opts.readOnly) {
        const method = String(args['method'] ?? 'GET').toUpperCase();
        const body = typeof args['body'] === 'string' ? args['body'] : '';
        if ((method !== 'GET' && method !== 'HEAD') || body.trim() !== '') {
          return { ok: false, output: 'autonomous mode allows read-only requests only' };
        }
      }
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return { ok: false, output: `invalid url: ${raw}` };
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, output: `unsupported scheme: ${url.protocol}` };
      }
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const signal = AbortSignal.any([ctx.signal, timeout]);
      try {
        const res = await doFetch(url, {
          method: String(args['method'] ?? 'GET'),
          body: typeof args['body'] === 'string' ? args['body'] : undefined,
          signal,
          redirect: 'follow',
        });
        // The whole body is not read into memory: reading stops once the limit is full.
        let text = '';
        if (res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (text.length >= MAX_OUTPUT) {
              await reader.cancel().catch(() => undefined);
              break;
            }
          }
        } else {
          text = await res.text();
        }
        return { ok: res.ok, output: truncate(`HTTP ${res.status}\n\n${text}`) };
      } catch (err) {
        const message = signal.aborted ? 'aborted or timed out' : (err as Error).message;
        return { ok: false, output: `fetch failed: ${message}` };
      }
    },
  };
}
