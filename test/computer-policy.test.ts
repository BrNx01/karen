import { describe, it, expect } from 'vitest';
import {
  availableComputerTools,
  COMPUTER_TOOLS,
  decideComputerAction,
  MAX_ACTIONS_PER_TURN,
  SECRET_SHAPE,
} from '../server/engine/computer-policy.js';

describe('decideComputerAction', () => {
  it('denies everything when control is off', () => {
    for (const tool of COMPUTER_TOOLS) {
      expect(decideComputerAction({ tool, args: {}, mode: 'off' }), tool).toBe('deny');
    }
  });

  it('asks for mutating actions in ask mode', () => {
    expect(decideComputerAction({ tool: 'mouse_click', args: { x: 10, y: 20 }, mode: 'ask' })).toBe('ask');
    expect(decideComputerAction({ tool: 'type_text', args: { text: 'hello' }, mode: 'ask' })).toBe('ask');
    expect(decideComputerAction({ tool: 'window_close', args: {}, mode: 'ask' })).toBe('ask');
  });

  it('lets read-only actions through in ask mode', () => {
    expect(decideComputerAction({ tool: 'window_list', args: {}, mode: 'ask' })).toBe('approve');
    expect(decideComputerAction({ tool: 'ui_tree', args: {}, mode: 'ask' })).toBe('approve');
  });

  it('approves input in allow mode', () => {
    expect(decideComputerAction({ tool: 'mouse_click', args: { x: 1, y: 2 }, mode: 'allow' })).toBe('approve');
    expect(decideComputerAction({ tool: 'type_text', args: { text: 'open the build folder' }, mode: 'allow' })).toBe('approve');
  });

  it('still asks before closing or moving a window in allow mode', () => {
    expect(decideComputerAction({ tool: 'window_close', args: {}, mode: 'allow' })).toBe('ask');
    expect(decideComputerAction({ tool: 'window_move', args: {}, mode: 'allow' })).toBe('ask');
  });

  it('still asks when the typed text looks like a credential', () => {
    expect(decideComputerAction({ tool: 'type_text', args: { text: 'password: hunter2' }, mode: 'allow' })).toBe('ask');
    expect(decideComputerAction({ tool: 'type_text', args: { text: 'api_key = abc123' }, mode: 'allow' })).toBe('ask');
  });

  it('still asks when the typed text contains a stored secret', () => {
    expect(
      decideComputerAction({
        tool: 'type_text',
        args: { text: 'paste sk-live-9f8a7b6c' },
        mode: 'allow',
        secrets: ['sk-live-9f8a7b6c'],
      }),
    ).toBe('ask');
  });

  it('ignores short secret strings, so a two-letter key cannot block typing', () => {
    expect(decideComputerAction({ tool: 'type_text', args: { text: 'abcde' }, mode: 'allow', secrets: ['ab'] })).toBe('approve');
  });

  it('asks for an unknown tool rather than guessing', () => {
    expect(decideComputerAction({ tool: 'open_the_pod_bay', args: {}, mode: 'allow' })).toBe('ask');
  });

  it('refuses screen reading when the setting is off', () => {
    expect(decideComputerAction({ tool: 'screen_read', args: {}, mode: 'allow', screenshots: false })).toBe('deny');
    expect(decideComputerAction({ tool: 'screen_read', args: {}, mode: 'allow', screenshots: true })).toBe('ask');
  });
});

describe('availableComputerTools', () => {
  it('is empty when control is off', () => {
    expect(availableComputerTools('off', true)).toEqual([]);
  });

  it('hides screen reading when screenshots are off', () => {
    const tools = availableComputerTools('ask', false);
    expect(tools).not.toContain('screen_read');
    expect(tools).toContain('mouse_click');
  });
});

describe('limits', () => {
  it('caps a turn at 30 actions', () => {
    expect(MAX_ACTIONS_PER_TURN).toBe(30);
  });

  it('treats common credential labels as secret shapes', () => {
    for (const sample of ['password: x', 'passwd = y', 'şifre: z', 'token: t', 'secret=1', 'api-key: k']) {
      expect(SECRET_SHAPE.test(sample), sample).toBe(true);
    }
    expect(SECRET_SHAPE.test('open the settings window')).toBe(false);
  });
});
