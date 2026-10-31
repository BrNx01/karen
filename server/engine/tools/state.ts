import { MAX_MODEL_DELTA, type EmotionKey } from '../../brain/state.js';
import type { StateStore } from '../../brain/store.js';
import type { Tool } from './types.js';

const EMOTIONS: readonly EmotionKey[] = ['cortisol', 'dopamine', 'serotonin', 'fatigue'];

/**
 * Proposes a small contribution to the model's own internal state.
 * Trauma, identity and approval cannot be changed with this tool; only ±0.10 to one of four emotions.
 */
export function stateTools(state: StateStore): Tool[] {
  let usedThisTurn = false;

  return [
    {
      access: 'read',
      def: {
        name: 'feel',
        description:
          'Propose a small contribution to your internal state (at most ±0.10). Trauma, identity and approval cannot be changed with this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            emotion: { type: 'string', description: 'cortisol | dopamine | serotonin | fatigue' },
            delta: { type: 'number', description: '-0.10 .. 0.10' },
            reason: { type: 'string', description: 'Why this feeling (evidence)' },
          },
          required: ['emotion', 'delta', 'reason'],
        },
      },
      async run(args) {
        // The tool list is rebuilt every turn; the flag thus resets per turn.
        if (usedThisTurn) return { ok: false, output: 'feel already used this turn' };

        const emotion = args['emotion'];
        if (typeof emotion !== 'string' || !EMOTIONS.includes(emotion as EmotionKey)) {
          return { ok: false, output: `unknown emotion: ${String(emotion)} (cortisol | dopamine | serotonin | fatigue)` };
        }

        const raw = args['delta'];
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          return { ok: false, output: 'delta must be a finite number' };
        }
        const delta = Math.min(MAX_MODEL_DELTA, Math.max(-MAX_MODEL_DELTA, raw));

        const reason = typeof args['reason'] === 'string' ? args['reason'].trim() : '';
        if (reason === '') return { ok: false, output: 'reason required' };

        usedThisTurn = true;
        state.record({ kind: 'feel', emotion: emotion as EmotionKey, delta });
        return { ok: true, output: `${emotion} ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} · ${reason}` };
      },
    },
  ];
}
