import { describe, it, expect } from 'vitest';
import { assess, REFLEX_TOOLS, REPEAT_LIMIT, signature } from '../server/brain/reflex.js';
import {
  REFLEX_EVENT_MS,
  reflexMonitorState,
  reflexTick,
  type ReflexMonitorDeps,
} from '../server/brain/reflex-monitor.js';
import { EventLog } from '../server/store/events.js';
import { SessionManager } from '../server/sessions.js';
import type { Tool } from '../server/engine/tools/types.js';
import type { StreamRequest, Delta } from '../server/engine/types.js';

/** Shadows the real tool: runs nothing, only records the call. */
function stubTool(name: string, ran: Record<string, unknown>[]): Tool {
  return {
    def: { name, description: name, inputSchema: {} },
    access: 'exec',
    run: async (args) => {
      ran.push(args);
      return { ok: true, output: 'ok' };
    },
  };
}

describe('assess', () => {
  it('no intervention on normal RAM', () => {
    expect(assess({ rssMb: 500, totalMb: 16000, repeats: 0, tool: '' })).toEqual({ action: 'none' });
  });

  it('kills the oldest above 90% RAM', () => {
    expect(assess({ rssMb: 14_500, totalMb: 16000, repeats: 0, tool: '' }).action).toBe('kill-oldest');
  });

  it('no intervention when total RAM is unknown', () => {
    expect(assess({ rssMb: 9999, totalMb: 0, repeats: 0, tool: '' })).toEqual({ action: 'none' });
  });

  it('cuts the session after a side-effect tool repeats 3 times', () => {
    const v = assess({ rssMb: 100, totalMb: 16000, repeats: REPEAT_LIMIT, tool: 'run_command' });
    expect(v.action).toBe('abort-session');
  });

  it('read tools do not trigger a cut when repeated', () => {
    for (const tool of ['read_file', 'memory_search', 'web_search', 'world_query']) {
      expect(assess({ rssMb: 100, totalMb: 16000, repeats: 10, tool }).action).toBe('none');
    }
  });

  it('does not cut below the threshold', () => {
    expect(assess({ rssMb: 100, totalMb: 16000, repeats: 2, tool: 'write_file' }).action).toBe('none');
  });

  it('the side-effect tool set is as expected', () => {
    for (const tool of ['run_command', 'write_file', 'edit_file', 'open_app', 'clipboard_write', 'spawn_session']) {
      expect(REFLEX_TOOLS.has(tool)).toBe(true);
    }
  });

  it('the signature ignores argument order', () => {
    expect(signature('run_command', { b: 2, a: 1 })).toBe(signature('run_command', { a: 1, b: 2 }));
    expect(signature('run_command', { a: 1 })).not.toBe(signature('write_file', { a: 1 }));
  });
});

describe('memory monitor', () => {
  it('two different workers die in two turns and one reflex event is written per window', () => {
    const log = new EventLog(':memory:');
    const aborted: string[] = [];
    const notices: string[] = [];
    let running = [
      { id: 'w1', role: 'worker', status: 'running', createdAt: 1 },
      { id: 'w2', role: 'worker', status: 'running', createdAt: 2 },
      { id: 'b', role: 'brain', status: 'running', createdAt: 0 },
    ];
    const deps: ReflexMonitorDeps = {
      list: () => running,
      abort: (id) => {
        aborted.push(id);
        running = running.map((s) => (s.id === id ? { ...s, status: 'idle' } : s));
      },
      notify: (_id, text) => notices.push(text),
      brain: () => ({ id: 'b' }),
      log,
    };
    const state = reflexMonitorState();
    const high = { rssMb: 15_000, totalMb: 16_000 };

    reflexTick(state, deps, high, 1_000_000);
    reflexTick(state, deps, high, 1_000_000 + REFLEX_EVENT_MS - 1);

    // the kill runs on every turn; the event fits in the 5-minute window.
    expect(aborted).toEqual(['w1', 'w2']);
    expect(log.read().filter((e) => e.kind === 'reflex')).toHaveLength(1);
    expect(notices).toHaveLength(1);
    // Beyin asla kurban olmaz.
    expect(aborted).not.toContain('b');
    log.close();
  });

  it('normal RAM kills nobody', () => {
    const log = new EventLog(':memory:');
    const aborted: string[] = [];
    const state = reflexMonitorState();
    const deps: ReflexMonitorDeps = {
      list: () => [{ id: 'w1', role: 'worker', status: 'running', createdAt: 1 }],
      abort: (id) => aborted.push(id),
      notify: () => undefined,
      brain: () => ({ id: 'b' }),
      log,
    };
    reflexTick(state, deps, { rssMb: 500, totalMb: 16_000 }, 1_000_000);
    expect(aborted).toEqual([]);
    expect(log.read().filter((e) => e.kind === 'reflex')).toHaveLength(0);
    log.close();
  });

  it('the victim is still eligible next turn if abort throws once', () => {
    const log = new EventLog(':memory:');
    const aborted: string[] = [];
    let throwOnce = true;
    const state = reflexMonitorState();
    const deps: ReflexMonitorDeps = {
      list: () => [{ id: 'w1', role: 'worker', status: 'running', createdAt: 1 }],
      abort: (id) => {
        aborted.push(id);
        if (throwOnce) {
          throwOnce = false;
          throw new Error('abort failed');
        }
      },
      notify: () => undefined,
      brain: () => ({ id: 'b' }),
      log,
    };
    const high = { rssMb: 15_000, totalMb: 16_000 };
    expect(() => reflexTick(state, deps, high, 1_000_000)).toThrow();
    reflexTick(state, deps, high, 1_000_000 + 1);
    // the exemption is written only after a successful kill.
    expect(aborted).toEqual(['w1', 'w1']);
    log.close();
  });
});

describe('reflex in the loop', () => {  it('the turn is cut after three identical side-effect calls, no approval is asked and the third call does not run', async () => {
    const log = new EventLog(':memory:');
    const ran: Record<string, unknown>[] = [];
    let calls = 0;
    const provider = {
      name: 'repeat',
      async *stream(req: StreamRequest) {
        void req;
        calls++;
        yield {
          type: 'tool_call' as const,
          call: { id: `c${calls}`, name: 'run_command', args: { command: 'node -v' } },
        } satisfies Delta;
        yield { type: 'done' as const, stopReason: 'tool_use' as const } satisfies Delta;
      },
    };
    let approvals = 0;
    const sessions = new SessionManager({
      provider: provider as never,
      model: 'm',
      log,
      approve: async () => {
        approvals++;
        return true;
      },
      extraTools: [stubTool('run_command', ran)],
      onEvent: () => undefined,
    });
    const s = sessions.create({ role: 'worker' });
    const result = await sessions.send(s.id, 'dene');
    expect(result.ok).toBe(true);
    expect(calls).toBe(REPEAT_LIMIT);
    // the first two calls go to approval; the third is cut by the reflex BEFORE approval.
    expect(approvals).toBe(REPEAT_LIMIT - 1);
    // the third call never reached the tool.
    expect(ran).toHaveLength(REPEAT_LIMIT - 1);
    expect(log.read().some((e) => e.kind === 'reflex')).toBe(true);
    log.close();
  });

  it('every tool_call in the batch is answered, the differing call does not run and the third is logged', async () => {
    const log = new EventLog(':memory:');
    const ran: Record<string, unknown>[] = [];
    const batch = [
      { id: 'c1', name: 'run_command', args: { command: 'node -v' } },
      { id: 'c2', name: 'run_command', args: { command: 'node -v' } },
      { id: 'c3', name: 'run_command', args: { command: 'node -v' } },
      // different signature: if the reflex cuts, this call must never run.
      { id: 'c4', name: 'run_command', args: { command: 'git push --force' } },
    ];
    const provider = {
      name: 'batch',
      async *stream() {
        for (const call of batch) yield { type: 'tool_call' as const, call } satisfies Delta;
        yield { type: 'done' as const, stopReason: 'tool_use' as const } satisfies Delta;
      },
    };
    const sessions = new SessionManager({
      provider: provider as never,
      model: 'm',
      log,
      approve: async () => true,
      extraTools: [stubTool('run_command', ran)],
      onEvent: () => undefined,
    });
    const s = sessions.create({ role: 'worker' });
    const result = await sessions.send(s.id, 'dene');
    expect(result.ok).toBe(true);

    // no unanswered tool_call remains: the next turn would be rejected by the provider.
    const history = sessions.history(s.id);
    const answered = new Set(history.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
    const asked = history.flatMap((m) => m.toolCalls ?? []).map((c) => c.id);
    expect(asked).toEqual(['c1', 'c2', 'c3', 'c4']);
    for (const id of asked) expect(answered.has(id)).toBe(true);

    // only the first two calls ran; the differing call never ran.
    expect(ran).toEqual([{ command: 'node -v' }, { command: 'node -v' }]);

    // forensic trail: the third attempt was also written as a tool_call, then the reflex fired.
    const toolCalls = log.read().filter((e) => e.kind === 'tool_call');
    expect(toolCalls).toHaveLength(3);
    expect(toolCalls.at(-1)?.payload['args']).toEqual({ command: 'node -v' });
    const reflex = log.read().filter((e) => e.kind === 'reflex');
    expect(reflex).toHaveLength(1);
    expect(reflex[0]?.payload['action']).toBe('abort-session');
    log.close();
  });

  it('remaining calls are answered when cancelled mid-batch', async () => {
    const log = new EventLog(':memory:');
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = (): void => undefined;
    const startedRun = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const started: string[] = [];
    const slow: Tool = {
      def: { name: 'run_command', description: 'slow', inputSchema: {} },
      access: 'exec',
      run: async (args) => {
        started.push(String(args['id']));
        entered();
        await gate;
        return { ok: true, output: 'ok' };
      },
    };
    const batch = [
      { id: 'c1', name: 'run_command', args: { id: 'c1' } },
      { id: 'c2', name: 'run_command', args: { id: 'c2' } },
      { id: 'c3', name: 'run_command', args: { id: 'c3' } },
    ];
    const provider = {
      name: 'batch',
      async *stream() {
        for (const call of batch) yield { type: 'tool_call' as const, call } satisfies Delta;
        yield { type: 'done' as const, stopReason: 'tool_use' as const } satisfies Delta;
        // no second turn: after a cancelled turn the provider is never called.
      },
    };
    const sessions = new SessionManager({
      provider: provider as never,
      model: 'm',
      log,
      approve: async () => true,
      extraTools: [slow],
      onEvent: () => undefined,
    });
    const s = sessions.create({ role: 'worker' });
    const pending = sessions.send(s.id, 'dene');
    // cancel in memory like a reflex while the first tool runs.
    await startedRun;
    sessions.abort(s.id);
    release();
    await pending;

    const history = sessions.history(s.id);
    const answered = new Set(history.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
    const asked = history.flatMap((m) => m.toolCalls ?? []).map((c) => c.id);
    expect(asked).toEqual(['c1', 'c2', 'c3']);
    for (const id of asked) expect(answered.has(id)).toBe(true);
    // only the first call reached the tool.
    expect(started).toEqual(['c1']);
    log.close();
  });
});
