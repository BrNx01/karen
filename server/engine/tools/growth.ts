import type { ProposalStore } from '../../growth/store.js';
import type { ProposalFile, ProposalKind } from '../../growth/proposals.js';
import type { Tool } from './types.js';

const KINDS: ProposalKind[] = ['identity', 'rule', 'skill', 'code'];

/**
 * The brain's self-improvement tools. They propose — they do not apply.
 * Applying is the user's click; these tools cannot do it.
 */
export function growthTools(store: ProposalStore, opts: { codeEditsEnabled: boolean }): Tool[] {
  return [
    {
      access: 'read',
      def: {
        name: 'propose_change',
        description:
          'Creates a self-improvement proposal (identity, rule, skill or limited code). The proposal first passes a deterministic audit; the user approves applying it.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: 'identity | rule | skill | code' },
            title: { type: 'string', description: 'Short title' },
            reason: { type: 'string', description: 'Why it is needed (with evidence)' },
            files: {
              type: 'array',
              description: 'Files to change; before/after full content',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'e.g. brain/rules/temel.md or app/src/x.ts' },
                  before: { type: 'string', description: 'Current full content' },
                  after: { type: 'string', description: 'New full content' },
                },
                required: ['path', 'after'],
              },
            },
          },
          required: ['kind', 'title', 'reason', 'files'],
        },
      },
      async run(args) {
        const kind = String(args['kind'] ?? '');
        if (!KINDS.includes(kind as ProposalKind)) return { ok: false, output: `invalid kind: ${kind}` };
        const filesRaw = args['files'];
        if (!Array.isArray(filesRaw) || filesRaw.length === 0) return { ok: false, output: 'files required' };

        const files: ProposalFile[] = [];
        for (const raw of filesRaw) {
          if (!raw || typeof raw !== 'object') continue;
          const item = raw as Record<string, unknown>;
          const path = typeof item['path'] === 'string' ? item['path'] : '';
          const after = typeof item['after'] === 'string' ? item['after'] : '';
          if (path === '') continue;
          // If before is not given it is read from the current file, so the patch is correct.
          const before = typeof item['before'] === 'string' ? item['before'] : store.readDataFile(path);
          files.push({ path, before, after });
        }
        if (files.length === 0) return { ok: false, output: 'no valid files' };

        try {
          const proposal = await store.submit(
            {
              kind: kind as ProposalKind,
              title: String(args['title'] ?? ''),
              reason: String(args['reason'] ?? ''),
              files,
            },
            { runBuild: kind === 'code' && opts.codeEditsEnabled },
          );
          const failed = proposal.checks.filter((check) => !check.ok);
          if (proposal.status === 'rejected') {
            return {
              ok: false,
              output: `proposal rejected (${failed.map((c) => `${c.name}: ${c.detail}`).join('; ')})`,
            };
          }
          return {
            ok: true,
            output: `proposal ready: ${proposal.id} · ${proposal.risk} risk · ${proposal.files.length} files. Awaiting user approval.`,
          };
        } catch (err) {
          return { ok: false, output: (err as Error).message };
        }
      },
    },
    {
      access: 'read',
      def: {
        name: 'growth_status',
        description: 'Lists pending and recently applied improvement proposals.',
        inputSchema: { type: 'object', properties: {} },
      },
      async run() {
        const pending = store.pending();
        const applied = store.list().filter((p) => p.status === 'applied').slice(-5);
        const lines: string[] = [];
        if (pending.length > 0) {
          lines.push('Pending:');
          for (const proposal of pending) lines.push(`${proposal.id} · ${proposal.kind} · ${proposal.title} (${proposal.risk})`);
        } else {
          lines.push('No pending proposals.');
        }
        if (applied.length > 0) {
          lines.push('Applied:');
          for (const proposal of applied) lines.push(`${proposal.id} · ${proposal.title}`);
        }
        return { ok: true, output: lines.join('\n') };
      },
    },
    {
      access: 'read',
      def: {
        name: 'read_identity',
        description: 'Reads its own identity and behavior rules (for an improvement proposal).',
        inputSchema: { type: 'object', properties: {} },
      },
      async run() {
        const files = store.dataFiles();
        if (files.length === 0) return { ok: true, output: 'no identity files' };
        return {
          ok: true,
          output: files.map((path) => `--- ${path}\n${store.readDataFile(path).slice(0, 3000)}`).join('\n\n'),
        };
      },
    },
  ];
}
