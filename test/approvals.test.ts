import { describe, it, expect, vi } from 'vitest';
import { ApprovalBroker } from '../server/http/approvals.js';
import type { PermissionRequest } from '../server/engine/permissions.js';

const req: PermissionRequest = { tool: 'run_command', access: 'exec', args: { command: 'rm -rf x' }, cwd: '.' };
const msg = (sessionId: string, requestId: string) => ({ type: 'approval_request' as const, sessionId, requestId, tool: 'run_command', args: {}, reason: 'dangerous: rm', className: 'important' as const });

describe('ApprovalBroker', () => {
  it('a matching request returns true, a foreign requestId false', async () => {
    const broker = new ApprovalBroker();
    const seen = vi.fn();
    const promise = broker.ask('s1', req, seen);
    const sent = seen.mock.calls[0]?.[0];
    expect(sent.sessionId).toBe('s1');
    expect(broker.pending('s1')).toHaveLength(1);

    // no other session can resolve this request
    expect(broker.resolve('s2', sent.requestId, true)).toBe(false);
    expect(broker.pending('s1')).toHaveLength(1);

    expect(broker.resolve('s1', sent.requestId, true)).toBe(true);
    await expect(promise).resolves.toBe(true);
    expect(broker.pending('s1')).toHaveLength(0);
  });

  it('rejects on timeout', async () => {
    const broker = new ApprovalBroker(20);
    const promise = broker.ask('s1', req, () => undefined);
    await expect(promise).resolves.toBe(false);
    expect(broker.pending('s1')).toHaveLength(0);
  });

  it('rejects on cancel and clears the queue', async () => {
    const broker = new ApprovalBroker();
    const promise = broker.ask('s1', req, () => undefined);
    broker.cancelSession('s1');
    await expect(promise).resolves.toBe(false);
    expect(broker.pending('s1')).toHaveLength(0);
  });
});
