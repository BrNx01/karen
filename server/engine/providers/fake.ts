import type { Delta, Provider, StreamRequest } from '../types.js';

/** For tests: each `stream` call emits the next scripted scenario. */
export class FakeProvider implements Provider {
  readonly name = 'fake';
  readonly calls: StreamRequest[] = [];
  private index = 0;

  constructor(private readonly script: Delta[][]) {}

  async *stream(req: StreamRequest): AsyncIterable<Delta> {
    this.calls.push(req);
    const turn = this.script[this.index++] ?? [{ type: 'done', stopReason: 'end' }];
    for (const delta of turn) {
      req.signal?.throwIfAborted();
      yield delta;
    }
  }
}
