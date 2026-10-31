import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import {
  normalizePath,
  resolveProposalPath,
  riskOf,
  runChecks,
  type CheckOptions,
  type Proposal,
  type ProposalFile,
  type ProposalKind,
} from './proposals.js';

export type ProposalInput = {
  kind: ProposalKind;
  title: string;
  reason: string;
  files: ProposalFile[];
};

export type GrowthDeps = {
  /** Settings/data folder. */
  dataDir: string;
  /** Source-copy root (code proposals). */
  repoRoot: string;
  /** Whether a code proposal can be applied (not in the packaged app, decision 12.1). */
  codeEditsEnabled: boolean;
};

/**
 * Proposal store: writes to disk and runs the deterministic pre-checks.
 * Applying and reverting are separate steps — the user gives the approval.
 */
export class ProposalStore {
  constructor(private readonly deps: GrowthDeps) {}

  private get dir(): string {
    return join(this.deps.dataDir, 'growth');
  }

  private get indexPath(): string {
    return join(this.dir, 'proposals.json');
  }

  list(): Proposal[] {
    if (!existsSync(this.indexPath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8')) as unknown;
      return Array.isArray(parsed) ? (parsed as Proposal[]) : [];
    } catch {
      return [];
    }
  }

  pending(): Proposal[] {
    return this.list().filter((p) => p.status === 'ready' || p.status === 'checking' || p.status === 'pending');
  }

  get(id: string): Proposal | undefined {
    return this.list().find((p) => p.id === id);
  }

  /** New proposal: checks first, then the record. A failing proposal becomes `rejected`. */
  async submit(input: ProposalInput, checkOpts: Omit<CheckOptions, 'repoRoot' | 'dataDir'> = {}): Promise<Proposal> {
    if (input.kind === 'code' && !this.deps.codeEditsEnabled) {
      throw new Error('code growth is only available in the source copy');
    }
    const proposal: Proposal = {
      id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      kind: input.kind,
      title: input.title.trim().slice(0, 160),
      reason: input.reason.trim().slice(0, 2000),
      files: input.files.map((file) => ({
        path: file.path,
        before: file.before.slice(0, 200_000),
        after: file.after.slice(0, 200_000),
      })),
      risk: riskOf(input),
      status: 'checking',
      checks: [],
    };

    proposal.checks = await runChecks(proposal, {
      repoRoot: this.deps.repoRoot,
      dataDir: this.deps.dataDir,
      runBuild: checkOpts.runBuild ?? input.kind === 'code',
      ...(checkOpts.timeoutMs === undefined ? {} : { timeoutMs: checkOpts.timeoutMs }),
    });
    proposal.status = proposal.checks.every((check) => check.ok) ? 'ready' : 'rejected';

    const all = this.list();
    all.push(proposal);
    this.save(all);
    return proposal;
  }

  reject(id: string): boolean {
    return this.update(id, (proposal) => {
      if (proposal.status === 'applied') return false;
      proposal.status = 'rejected';
      return true;
    });
  }

  /** Approved: the files are written, a code proposal lands as a single commit. */
  async apply(id: string): Promise<{ ok: boolean; error?: string }> {
    const proposal = this.get(id);
    if (!proposal) return { ok: false, error: 'proposal not found' };
    if (proposal.status !== 'ready') return { ok: false, error: `status not suitable: ${proposal.status}` };
    // A stored proposal may come from an older version: the allow-list surface is re-checked at apply time.
    if (proposal.kind === 'code' && !this.deps.codeEditsEnabled) {
      return { ok: false, error: 'code growth is only available in the source copy' };
    }
    const targets: string[] = [];
    for (const file of proposal.files) {
      const target = resolveProposalPath(file.path, proposal.kind, {
        repoRoot: this.deps.repoRoot,
        dataDir: this.deps.dataDir,
      });
      if (target === null) return { ok: false, error: `path outside allow-list: ${file.path}` };
      targets.push(target);
    }

    try {
      if (proposal.kind === 'code') {
        const dirty = await git(['status', '--porcelain'], this.deps.repoRoot);
        if (dirty.trim() !== '') return { ok: false, error: 'working tree is not clean; commit/revert first' };
      }

      for (const [i, file] of proposal.files.entries()) {
        const target = targets[i] as string;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.after, 'utf8');
      }

      if (proposal.kind === 'code') {
        await git(['add', ...proposal.files.map((f) => f.path)], this.deps.repoRoot);
        await git(['commit', '-m', `feat(growth): ${proposal.title}`], this.deps.repoRoot);
        const commit = (await git(['rev-parse', 'HEAD'], this.deps.repoRoot)).trim();
        this.update(id, (p) => {
          p.status = 'applied';
          p.commit = commit;
          p.appliedAt = Date.now();
          return true;
        });
        return { ok: true };
      }

      this.update(id, (p) => {
        p.status = 'applied';
        p.appliedAt = Date.now();
        return true;
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message.slice(0, 300) };
    }
  }

  /** Revert: `git revert` for a code proposal, the `before` text is written back for the others. */
  async revert(id: string): Promise<{ ok: boolean; error?: string }> {
    const proposal = this.get(id);
    if (!proposal) return { ok: false, error: 'proposal not found' };
    if (proposal.status !== 'applied') return { ok: false, error: `cannot revert: ${proposal.status}` };

    try {
      if (proposal.kind === 'code' && proposal.commit) {
        await git(['revert', '--no-edit', proposal.commit], this.deps.repoRoot);
      } else {
        // Writing back goes through the same permission gate: an old proposal cannot write outside the data folder.
        const targets = proposal.files.map((file) =>
          resolveProposalPath(file.path, proposal.kind, {
            repoRoot: this.deps.repoRoot,
            dataDir: this.deps.dataDir,
          }),
        );
        const bad = proposal.files.find((_file, i) => targets[i] === null);
        if (bad) return { ok: false, error: `path outside allow-list: ${bad.path}` };
        for (const [i, file] of proposal.files.entries()) {
          writeFileSync(targets[i] as string, file.before, 'utf8');
        }
      }
      this.update(id, (p) => {
        p.status = 'reverted';
        p.revertedAt = Date.now();
        return true;
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message.slice(0, 300) };
    }
  }

  private update(id: string, mutator: (proposal: Proposal) => boolean): boolean {
    const all = this.list();
    const proposal = all.find((p) => p.id === id);
    if (!proposal) return false;
    if (!mutator(proposal)) return false;
    this.save(all);
    return true;
  }

  private save(all: Proposal[]): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.indexPath}.tmp`;
    // The history must not bloat: the last 100 proposals are kept.
    const trimmed = all.slice(-100);
    writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf8');
    renameSync(tmp, this.indexPath);
  }

  /** Content of an existing file in the data folder (to build a patch). */
  readDataFile(path: string): string {
    const normalized = normalizePath(path);
    if (normalized === '') return '';
    const root = resolve(this.deps.dataDir);
    const target = resolve(root, normalized);
    if (target !== root && !target.startsWith(root + sep)) return '';
    if (!existsSync(target)) return '';
    try {
      return readFileSync(target, 'utf8');
    } catch {
      return '';
    }
  }

  /** List of identity/rule files in the data folder (what the brain may see). */
  dataFiles(): string[] {
    const roots = [
      { root: join(this.deps.dataDir, 'brain', 'identity'), prefix: 'brain/identity/' },
      { root: join(this.deps.dataDir, 'brain', 'rules'), prefix: 'brain/rules/' },
    ];
    const files: string[] = [];
    for (const { root, prefix } of roots) {
      if (!existsSync(root)) continue;
      for (const name of readdirSync(root)) {
        if (name.toLowerCase().endsWith('.md')) files.push(`${prefix}${name}`);
      }
    }
    return files;
  }
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolveGit, reject) => {
    execFile('git', args, { cwd, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${args[0]} failed: ${String(stderr || err.message).slice(0, 200)}`));
      else resolveGit(String(stdout));
    });
  });
}
