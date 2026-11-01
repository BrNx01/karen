/**
 * Cockpit state: which side panel is open, and whether the screen is cleared.
 * The default is *nothing* — the orb and the composer, as little else as possible.
 */
export type PanelId = 'conversation' | 'memory' | 'system' | 'inbox' | 'agents';

export type CockpitState = {
  panel: PanelId | null;
  /** Zen hides the dock as well: the orb alone. */
  zen: boolean;
};

export const DEFAULT_COCKPIT: CockpitState = { panel: null, zen: false };

/** Clicking the open panel's icon closes it; clicking another switches to it. */
export function togglePanel(state: CockpitState, panel: PanelId): CockpitState {
  return { ...state, panel: state.panel === panel ? null : panel };
}

export function closePanel(state: CockpitState): CockpitState {
  return state.panel === null ? state : { ...state, panel: null };
}

export function toggleZen(state: CockpitState): CockpitState {
  return { zen: !state.zen, panel: state.zen ? state.panel : null };
}

/** A new message should surface the conversation without the user hunting for it. */
export function autoOpen(state: CockpitState, reason: 'streaming' | 'approval'): CockpitState {
  if (state.panel !== null || state.zen) return state;
  return reason === 'streaming' || reason === 'approval' ? { ...state, panel: 'conversation' } : state;
}
