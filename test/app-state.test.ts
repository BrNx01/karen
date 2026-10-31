import { describe, it, expect } from 'vitest';
import { initialState, reduce, type AppState } from '../app/src/state.js';

const run = (actions: Parameters<typeof reduce>[1][]): AppState =>
  actions.reduce<AppState>((state, action) => reduce(state, action), initialState);

const approval = (requestId: string) => ({
  sessionId: 's1',
  requestId,
  tool: 'run_command',
  args: {},
  reason: 'dangerous: rm',
});

describe('reduce', () => {
  it('appends delta text to the last assistant message', () => {
    const state = run([
      { type: 'user', text: 'selam' },
      { type: 'delta', delta: { type: 'text', text: 'mer' } },
      { type: 'delta', delta: { type: 'text', text: 'haba' } },
    ]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({ role: 'assistant', text: 'merhaba' });
    expect(state.streaming).toBe(true);
  });

  it('done ends the feed', () => {
    expect(run([{ type: 'user', text: 'x' }, { type: 'done' }]).streaming).toBe(false);
  });

  it('keeps multiple approvals in order and does not duplicate the same request', () => {
    const state = run([
      { type: 'approval', approval: approval('r1') },
      { type: 'approval', approval: approval('r2') },
      { type: 'approval', approval: approval('r1') },
    ]);
    expect(state.approvals.map((a) => a.requestId)).toEqual(['r1', 'r2']);
  });

  it('only that card is removed when approval resolves', () => {
    const state = run([
      { type: 'approval', approval: approval('r1') },
      { type: 'approval', approval: approval('r2') },
      { type: 'clearApproval', requestId: 'r1' },
    ]);
    expect(state.approvals.map((a) => a.requestId)).toEqual(['r2']);
  });

  it('the approval list from the server changes state', () => {
    const state = run([{ type: 'approvals', approvals: [approval('r9')] }]);
    expect(state.approvals).toHaveLength(1);
  });

  it('the feed stops on error', () => {
    const state = run([{ type: 'user', text: 'x' }, { type: 'error', message: 'boom' }]);    expect(state.error).toBe('boom');
    expect(state.streaming).toBe(false);
  });

  it('switching session clears messages', () => {
    const state = run([{ type: 'user', text: 'x' }, { type: 'select', sessionId: 's2' }]);
    expect(state.activeId).toBe('s2');
    expect(state.messages).toEqual([]);
  });

  it('the notification is stored', () => {
    expect(run([{ type: 'notice', text: 'Rapor bitti' }]).notice).toBe('Rapor bitti');
  });
});
