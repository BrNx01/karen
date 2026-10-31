import type { SkillStore } from '../../skills.js';
import { toId } from '../../skills.js';
import type { Tool } from './types.js';

const MAX_BODY = 40_000;

export function loadSkillTool(store: SkillStore): Tool {
  return {
    access: 'read',
    def: {
      name: 'load_skill',
      description: 'Loads the full steps of a registered skill. Give the name listed in the catalogue.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Skill id from the catalogue' } },
        required: ['name'],
      },
    },
    async run(args) {
      const name = typeof args['name'] === 'string' ? args['name'].trim() : '';
      if (name === '') return { ok: false, output: 'name required' };
      // If the model gives the human name ("PDF Report"), convert it to the id.
      const body = store.read(name) ?? store.read(toId(name));
      if (body === null) return { ok: false, output: `unknown or disabled skill: ${name}` };
      if (body.length > MAX_BODY) {
        return { ok: true, output: `${body.slice(0, MAX_BODY)}\n…[truncated ${body.length - MAX_BODY} chars]` };
      }
      return { ok: true, output: body };
    },
  };
}
