import type { Settings } from '../settings.js';

export type ComputerDecision = 'deny' | 'ask' | 'approve';

/** Typed text that looks like a credential is never auto-approved. */
export const SECRET_SHAPE = /(password|passwd|parola|şifre|sifre|token|api[_-]?key|secret)\s*[:=]/i;

/** A turn cannot drive the machine forever. */
export const MAX_ACTIONS_PER_TURN = 30;

/** Windows that may be closed without asking: browsers and editors are not among them. */
const CLOSE_ALWAYS_ASKS = new Set(['window_close', 'window_move']);

/** Reads: listing windows and reading the accessibility tree have no side effect. */
const READ_ONLY = new Set(['window_list', 'ui_tree']);

export const COMPUTER_TOOLS = new Set([
  'mouse_move',
  'mouse_click',
  'mouse_drag',
  'scroll',
  'type_text',
  'press_keys',
  'window_list',
  'window_focus',
  'window_move',
  'window_close',
  'ui_tree',
  'ui_invoke',
  'screen_read',
]);

/**
 * Decides what the permission gate should do with one computer action.
 * `off` removes the tools from the schema entirely; `allow` still asks for two things:
 * typing something that looks like a secret, and closing or moving a window.
 */
export function decideComputerAction(input: {
  tool: string;
  args: Record<string, unknown>;
  mode: Settings['computerControl'];
  /** Stored secret values; a typed match is treated like `SECRET_SHAPE`. */
  secrets?: string[];
  /** Screen reading needs the setting, and a vision model. */
  screenshots?: boolean;
}): ComputerDecision {
  if (input.mode === 'off') return 'deny';
  if (!COMPUTER_TOOLS.has(input.tool)) return 'ask';
  if (input.tool === 'screen_read') return input.screenshots === false ? 'deny' : 'ask';
  if (READ_ONLY.has(input.tool)) return 'approve';
  if (input.mode === 'ask') return 'ask';

  // mode === 'allow'
  if (CLOSE_ALWAYS_ASKS.has(input.tool)) return 'ask';
  if (input.tool === 'type_text') {
    const text = typeof input.args['text'] === 'string' ? input.args['text'] : '';
    if (SECRET_SHAPE.test(text)) return 'ask';
    for (const secret of input.secrets ?? []) {
      if (secret.length >= 6 && text.includes(secret)) return 'ask';
    }
  }
  return 'approve';
}

/** Tool names the model may see, given the current mode. */
export function availableComputerTools(mode: Settings['computerControl'], screenshots: boolean): string[] {
  if (mode === 'off') return [];
  return [...COMPUTER_TOOLS].filter((tool) => (tool === 'screen_read' ? screenshots : true));
}
