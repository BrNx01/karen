import { describe, it, expect } from 'vitest';
import { webSearchTool } from '../server/engine/tools/web.js';
import { classify } from '../server/engine/permissions.js';

const ctx = { cwd: '.', signal: new AbortController().signal };

const html = `<div class="result"><a class="result__a" href="https://example.com/a">C++ AI hızlandırma</a>
<a class="result__snippet">Derleyici optimizasyonu üzerine.</a></div>`;

const fetchOk = (body: string): typeof fetch =>
  (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;

describe('web_search', () => {
  it('it is a network read but requires approval', () => {
    const tool = webSearchTool();
    expect(tool.access).toBe('read');
    expect(classify({ tool: 'web_search', access: 'read', args: {}, cwd: '.' }).class).toBe('important');
  });

  it('returns results as title + url', async () => {
    const tool = webSearchTool({ fetchImpl: fetchOk(html) });
    const out = await tool.run({ query: 'c++ ai' }, ctx);
    expect(out.ok).toBe(true);
    expect(out.output).toContain('https://example.com/a');
    expect(out.output).toContain('C++ AI');
  });

  it('an empty query is rejected', async () => {
    const out = await webSearchTool().run({ query: '   ' }, ctx);
    expect(out.ok).toBe(false);
  });

  it('fabricates nothing on a network error and returns ok:false', async () => {
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const out = await webSearchTool({ fetchImpl: boom }).run({ query: 'x' }, ctx);
    expect(out.ok).toBe(false);
    expect(out.output).not.toContain('http');
  });

  it('ok:false when there are no results', async () => {
    const out = await webSearchTool({ fetchImpl: fetchOk('<html>boş</html>') }).run({ query: 'zzz' }, ctx);
    expect(out.ok).toBe(false);
  });
});
