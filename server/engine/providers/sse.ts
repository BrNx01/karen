export type SSEEvent = { event?: string; data: string };

export async function* parseSSE(chunks: AsyncIterable<string>): AsyncIterable<SSEEvent> {
  let buffer = '';
  for await (const chunk of chunks) {
    buffer += chunk.replace(/\r\n/g, '\n');
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const parsed = parseBlock(raw);
      if (parsed) yield parsed;
      index = buffer.indexOf('\n\n');
    }
  }
  const tail = parseBlock(buffer);
  if (tail) yield tail;
}

function parseBlock(raw: string): SSEEvent | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

/** Converts the response body to text chunk by chunk. */
export async function* responseChunks(res: Response): AsyncIterable<string> {
  if (!res.body) {
    yield await res.text();
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
  const rest = decoder.decode();
  if (rest) yield rest;
}
