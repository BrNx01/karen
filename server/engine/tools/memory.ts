import type { MemoryStore } from '../../memory/notes.js';
import type { Tool } from './types.js';

/**
 * Explicit memory review: "this note was useful".
 * Raises storage strength (never decreases) and grows stability with FSRS.
 */
export function memoryTools(memory: MemoryStore): Tool[] {
  return [
    {
      access: 'read',
      def: {
        name: 'memory_review',
        description:
          'Reports that you find a memory useful/correct. The note is remembered longer and decays less easily. Use again if it is wrong.',
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'Memory id (from the source list)' },
            grade: { type: 'string', description: 'good | easy | hard | again (default good)' },
          },
          required: ['noteId'],
        },
      },
      async run(args) {
        const id = typeof args['noteId'] === 'string' ? args['noteId'] : '';
        if (id === '') return { ok: false, output: 'noteId required' };
        const grade = String(args['grade'] ?? 'good');
        const allowed = ['good', 'easy', 'hard', 'again'] as const;
        const chosen = (allowed as readonly string[]).includes(grade) ? (grade as (typeof allowed)[number]) : 'good';
        if (!memory.review(id, chosen)) return { ok: false, output: `no memory: ${id}` };
        const note = memory.get(id);
        return {
          ok: true,
          output: `review saved (${chosen}) · stability ${note?.stability.toFixed(1)} days · storage ${note?.storage}`,
        };
      },
    },
    {
      access: 'read',
      def: {
        name: 'memory_search',
        description: 'Searches memory (left lobe words, right lobe association) and ranks by strength score.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Topic to search' },
            limit: { type: 'number', description: 'Default 5' },
          },
          required: ['query'],
        },
      },
      async run(args) {
        const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
        if (query === '') return { ok: false, output: 'query required' };
        const limit = typeof args['limit'] === 'number' ? Math.min(20, args['limit']) : 5;
        const hits = memory.recall(query, { limit });
        if (hits.length === 0) return { ok: true, output: 'no matching memories' };
        return {
          ok: true,
          output: hits
            .map(
              (hit) =>
                `- [${hit.id}] (${hit.kind}, strength ${hit.strength.toFixed(2)}) ${hit.text.slice(0, 200)} [source: ${hit.evidence
                  .slice(0, 4)
                  .map((id) => `#${id}`)
                  .join(' ')}]`,
            )
            .join('\n'),
        };
      },
    },
  ];
}
