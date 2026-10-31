import type { ComputeOp, WorldModel } from '../../memory/world.js';
import type { Tool } from './types.js';

const OPS: ComputeOp[] = ['sum', 'count', 'latest', 'earliest', 'next', 'avg'];

export function worldTools(world: WorldModel): Tool[] {
  return [
    {
      access: 'read',
      def: {
        name: 'world_query',
        description:
          'Lists typed facts in the world model (budget, price, duration, date, time, rate). Each row carries a source event id.',
        inputSchema: {
          type: 'object',
          properties: {
            entity: { type: 'string', description: 'Project/entity key' },
            attribute: { type: 'string', description: 'Attribute name (budget, price, backup time…)' },
            kind: {
              type: 'string',
              description: 'number | money | date | duration | percent | count | text',
            },
            asOf: { type: 'string', description: 'A past moment (ISO date) — the facts valid at that moment' },
            includeHistory: { type: 'boolean', description: 'Also show superseded facts' },
            limit: { type: 'number', description: 'Default 20' },
          },
        },
      },
      async run(args) {
        const facts = world.facts({
          ...(typeof args['entity'] === 'string' ? { entity: args['entity'] } : {}),
          ...(typeof args['attribute'] === 'string' ? { attribute: args['attribute'] } : {}),
          ...(typeof args['kind'] === 'string' ? { kind: args['kind'] as never } : {}),
          ...(typeof args['asOf'] === 'number' ? { asOf: args['asOf'] } : {}),
          ...(typeof args['asOf'] === 'string' ? { asOf: Date.parse(args['asOf']) || undefined } : {}),
          ...(args['includeHistory'] === true ? { includeHistory: true } : {}),
          limit: typeof args['limit'] === 'number' ? args['limit'] : 20,
        });
        if (facts.length === 0) return { ok: true, output: 'no stored facts' };
        const lines = facts.map((f) => {
          const window = f.validTo === null ? 'valid' : `ended: ${new Date(f.validTo).toISOString().slice(0, 10)}`;
          return `${f.entity} · ${f.attribute} = ${f.valueText}${f.unit ? ` (${f.unit})` : ''} [${window}, source: ${f.sourceEvent}]`;
        });
        return { ok: true, output: lines.join('\n') };
      },
    },
    {
      access: 'read',
      def: {
        name: 'world_compute',
        description:
          'Performs a deterministic calculation over the world model: sum, count, avg, latest, earliest, next. The result is derived from real rows.',
        inputSchema: {
          type: 'object',
          properties: {
            op: { type: 'string', description: 'sum | count | avg | latest | earliest | next' },
            attribute: { type: 'string', description: 'Attribute to compute' },
            entity: { type: 'string', description: 'Entity filter (optional)' },
            includeHistory: { type: 'boolean', description: 'Also include superseded facts (meaningless for sum/avg)' },
          },
          required: ['op', 'attribute'],
        },
      },
      async run(args) {
        const op = String(args['op'] ?? '') as ComputeOp;
        if (!OPS.includes(op)) return { ok: false, output: `invalid operation: ${op}` };
        const attribute = typeof args['attribute'] === 'string' ? args['attribute'] : '';
        if (attribute === '') return { ok: false, output: 'attribute required' };
        const result = world.compute(
          op,
          attribute,
          typeof args['entity'] === 'string' ? args['entity'] : undefined,
          { includeHistory: args['includeHistory'] === true },
        );
        if (result.reason) return { ok: false, output: result.reason };
        if (result.matched === 0) return { ok: false, output: `no records for "${attribute}"` };
        const value = result.value === null ? 'none' : String(result.value);
        return {
          ok: true,
          output: `${op}(${attribute}) = ${value} · ${result.matched} records · sources: ${result.sourceEvents
            .slice(0, 6)
            .map((id) => `#${id}`)
            .join(' ')}`,
        };
      },
    },
    {
      access: 'read',
      def: {
        name: 'world_history',
        description: 'Lists past actions: which tool, what it did, whether it succeeded, how long it took.',
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'number', description: 'Default 10' } },
        },
      },
      async run(args) {
        const rows = world.history(typeof args['limit'] === 'number' ? args['limit'] : 10);
        if (rows.length === 0) return { ok: true, output: 'no stored actions' };
        return {
          ok: true,
          output: rows
            .map(
              (r) =>
                `${new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')} · ${r.tool} → ${r.status} · ${r.summary.slice(0, 100)}`,
            )
            .join('\n'),
        };
      },
    },
  ];
}
