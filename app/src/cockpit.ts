/**
 * Cockpit layout state. The panels are the point: they collapse, they remember, and
 * a "zen" toggle clears both so only the core and the composer are left on screen.
 */
export type PanelSide = 'left' | 'right';

export type PanelState = {
  left: boolean;
  right: boolean;
  /** Zen hides both panels regardless of their own flags. */
  zen: boolean;
  /** What to restore when zen is turned off. */
  restore: { left: boolean; right: boolean };
};

export const DEFAULT_PANELS: PanelState = {
  left: true,
  right: true,
  zen: false,
  restore: { left: true, right: true },
};

/** Toggling a panel leaves zen: the user asked to see something. */
export function togglePanel(state: PanelState, side: PanelSide): PanelState {
  if (state.zen) {
    // In zen the click means "show me that panel", not "hide it".
    return {
      ...state,
      zen: false,
      left: side === 'left' ? true : state.restore.left,
      right: side === 'right' ? true : state.restore.right,
      restore: { left: side === 'left' ? true : state.restore.left, right: side === 'right' ? true : state.restore.right },
    };
  }
  return { ...state, [side]: !state[side] } as PanelState;
}

export function toggleZen(state: PanelState): PanelState {
  if (state.zen) {
    return { ...state, zen: false, left: state.restore.left, right: state.restore.right };
  }
  return { ...state, zen: true, restore: { left: state.left, right: state.right } };
}

export function isVisible(state: PanelState, side: PanelSide): boolean {
  return !state.zen && state[side];
}

/** Which card the cockpit should light up, given what KAREN just did. */
export type CockpitCard = 'core' | 'memory' | 'system';

export function cardForEvent(kind: string): CockpitCard | null {
  if (kind === 'memory_note' || kind === 'memory_score' || kind === 'memory_link') return 'memory';
  if (kind === 'state_signal' || kind === 'state_change' || kind === 'state_feel') return 'core';
  if (kind === 'tool_call' || kind === 'tool_result' || kind === 'error') return 'system';
  return null;
}

/**
 * A focused card grows and the others step back; 1 for the focused card, 0.35 for
 * the rest. Nothing focused means every card is equal.
 */
export function cardEmphasis(card: CockpitCard, focused: CockpitCard | null): number {
  if (focused === null) return 1;
  return card === focused ? 1 : 0.35;
}

/** The class list for a card, so the CSS stays declarative. */
export function cardClass(card: CockpitCard, focused: CockpitCard | null, collapsed: boolean): string {
  const parts = ['cockpit-card', `card-${card}`];
  if (focused === card) parts.push('focused');
  else if (focused !== null) parts.push('dimmed');
  if (collapsed) parts.push('collapsed');
  return parts.join(' ');
}

/** Panels are a preference, not session state: they survive a reload. */
export function parsePanels(raw: string | null): PanelState {
  if (raw === null) return DEFAULT_PANELS;
  try {
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      left: typeof parsed.left === 'boolean' ? parsed.left : true,
      right: typeof parsed.right === 'boolean' ? parsed.right : true,
      zen: parsed.zen === true,
      restore: {
        left: parsed.restore?.left ?? true,
        right: parsed.restore?.right ?? true,
      },
    };
  } catch {
    return DEFAULT_PANELS;
  }
}

export function stringifyPanels(state: PanelState): string {
  return JSON.stringify(state);
}
