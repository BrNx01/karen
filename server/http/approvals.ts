import { randomUUID } from 'node:crypto';
import type { PermissionRequest } from '../engine/permissions.js';

export type ApprovalRequestMsg = {
  type: 'approval_request';
  sessionId: string;
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  className: 'simple' | 'important';
};

type Pending = {
  sessionId: string;
  message: ApprovalRequestMsg;
  settle: (allow: boolean) => void;
};

export const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000;

export class ApprovalBroker {
  private readonly entries = new Map<string, Pending>();

  constructor(private readonly timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS) {}

  ask(
    sessionId: string,
    req: PermissionRequest,
    notify: (msg: ApprovalRequestMsg) => void,
  ): Promise<boolean> {
    const requestId = randomUUID();
    const message: ApprovalRequestMsg = {
      type: 'approval_request',
      sessionId,
      requestId,
      tool: req.tool,
      args: req.args,
      reason: 'onay gerekli',
      className: 'important',
    };
    const key = `${sessionId}:${requestId}`;

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.settle(key, false), this.timeoutMs);
      timer.unref?.();
      this.entries.set(key, {
        sessionId,
        message,
        settle: (allow) => {
          clearTimeout(timer);
          resolve(allow);
        },
      });
      notify(message);
    });
  }

  /** Only the owning session of the request can resolve it. */
  resolve(sessionId: string, requestId: string, allow: boolean): boolean {
    return this.settle(`${sessionId}:${requestId}`, allow);
  }

  cancelSession(sessionId: string): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.sessionId === sessionId) this.settle(key, false);
    }
  }

  pending(sessionId?: string): ApprovalRequestMsg[] {
    return [...this.entries.values()]
      .filter((e) => sessionId === undefined || e.sessionId === sessionId)
      .map((e) => e.message);
  }

  private settle(key: string, allow: boolean): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    entry.settle(allow);
    return true;
  }
}
