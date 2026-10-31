import type { Tool } from './types.js';
import { speak as speakLocal } from '../../voice/index.js';

/**
 * The model's spoken output. `read` class: it does not send data outside, it only
 * does local speech synthesis.
 */
export function speakTool(): Tool {
  return {
    access: 'read',
    def: {
      name: 'speak',
      description: 'Answers the user with local text-to-speech (keep it short).',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to speak (max 500 characters)' } },
        required: ['text'],
      },
    },
    async run(args) {
      const text = typeof args['text'] === 'string' ? args['text'].trim().slice(0, 500) : '';
      if (text === '') return { ok: false, output: 'text required' };
      const result = await speakLocal(text);
      return result.ok
        ? { ok: true, output: 'seslendirildi' }
        : { ok: false, output: `seslendirme yok: ${result.reason}` };
    },
  };
}
