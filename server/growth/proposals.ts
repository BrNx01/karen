import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Self-improvement — proposed, approved, revertible.
 *
 * The shared conclusion of the research: a self-writing agent that can edit its own gate
 * removes the gate. Therefore:
 * - the proposer and the approver are separate (the brain proposes, the user applies),
 * - every proposal goes through deterministic pre-checks (allow-list, size, secret, build, test),
 * - an applied proposal is a single commit and is reverted with `git revert`.
 */

export type ProposalKind = 'identity' | 'rule' | 'skill' | 'code';
export type ProposalRisk = 'low' | 'medium' | 'high';
export type ProposalStatus = 'pending' | 'checking' | 'ready' | 'rejected' | 'applied' | 'reverted';

export type ProposalFile = { path: string; before: string; after: string };

export type ProposalCheck = { name: string; ok: boolean; detail: string };

export type Proposal = {
  id: string;
  createdAt: number;
  kind: ProposalKind;
  title: string;
  reason: string;
  files: ProposalFile[];
  risk: ProposalRisk;
  status: ProposalStatus;
  checks: ProposalCheck[];
  commit?: string;
  appliedAt?: number;
  revertedAt?: number;
};

/** Paths that may be proposed (an allow-list — not a deny-list, decision 12.5). */
export const ALLOWED_PREFIXES = ['app/', 'server/memory/', 'server/dashboard.ts', 'docs/'];

/** Proposable paths in the data folder (outside git). */
export const DATA_PREFIXES = ['brain/identity/', 'brain/rules/', 'skills/'];

/** Protected files: guarded by canonical path equality (not by prefix). */
export const PROTECTED_FILES = ['server/memory/identity.ts'];

/** Protected paths: they cannot even be proposed. */
export const PROTECTED_PREFIXES = [
  'brain/core/',
  'server/engine/',
  'server/http/',
  'server/store/',
  'server/growth/',
  'server/settings.ts',
  'server/sessions.ts',
  'server/serve.ts',
  'server/cli.ts',
  'test/',
  'electron/',
  'package.json',
  'package-lock.json',
  '.github/',
];

export const MAX_FILES = 3;
export const MAX_LINES = 200;

/** Windows/macOS file systems are case-insensitive: the protection compares the same way. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

function samePath(a: string, b: string): boolean {
  return CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function startsWithPath(path: string, prefix: string): boolean {
  return CASE_INSENSITIVE ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix);
}

export function isProtected(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized === '') return false;
  if (PROTECTED_FILES.some((file) => samePath(normalized, file))) return true;
  return PROTECTED_PREFIXES.some((prefix) => samePath(normalized, prefix) || startsWithPath(normalized, prefix));
}

export function isAllowed(path: string, kind: ProposalKind): boolean {
  const normalized = normalizePath(path);
  if (normalized === '') return false;
  if (isProtected(normalized)) return false;
  if (kind === 'code') {
    return ALLOWED_PREFIXES.some((prefix) => samePath(normalized, prefix) || startsWithPath(normalized, prefix));
  }
  return DATA_PREFIXES.some((prefix) => startsWithPath(normalized, prefix));
}

/**
 * Canonical path: separators become `/`, empty and `.` segments are dropped, `..` returns
 * the empty sentinel (so it cannot slip past the prefix comparison). On Windows a trailing
 * dot/space is stripped because the file system ignores it: `identity.ts.` → `identity.ts`.
 */
export function normalizePath(path: string): string {
  const segments: string[] = [];
  for (let segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '..') return '';
    // `:` is banned on every platform: on Windows an ADS (`file::$DATA`) overwrites the real file.
    if (segment.includes(':')) return '';
    if (process.platform === 'win32') segment = segment.replace(/[. ]+$/, '');
    if (segment === '' || segment === '.') continue;
    segments.push(segment);
  }
  return segments.join('/');
}

/** Total changed line count of the patch (rough measure: added + removed). */
export function changedLines(files: ProposalFile[]): number {
  let total = 0;
  for (const file of files) {
    const before = file.before.split('\n');
    const after = file.after.split('\n');
    if (before.join('\n') === after.join('\n')) continue;
    const setBefore = new Map<string, number>();
    for (const line of before) setBefore.set(line, (setBefore.get(line) ?? 0) + 1);
    let removed = 0;
    for (const line of after) {
      const count = setBefore.get(line) ?? 0;
      if (count > 0) setBefore.set(line, count - 1);
      else total++;
    }
    for (const count of setBefore.values()) removed += count;
    total += removed;
  }
  return total;
}

const SECRET_PATTERNS = [
  /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(password|parola|şifre|sifre|secret|token)\s*[:=]\s*\S{6,}/i,
];

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export type CheckOptions = {
  /** Repo root (for code proposals). */
  repoRoot?: string;
  /** Data folder (for identity/rule/skill proposals). */
  dataDir?: string;
  /** Run build + tests (for code proposals). */
  runBuild?: boolean;
  timeoutMs?: number;
};

/**
 * Deterministic pre-checks. The LLM's "this is harmless" opinion does not count here.
 * If one of them fails, the proposal is never shown to the user at all.
 */
export async function runChecks(proposal: Proposal, opts: CheckOptions = {}): Promise<ProposalCheck[]> {
  const checks: ProposalCheck[] = [];

  checks.push({
    name: 'size',
    ok: proposal.files.length > 0 && proposal.files.length <= MAX_FILES && changedLines(proposal.files) <= MAX_LINES,
    detail: `${proposal.files.length} dosya, ${changedLines(proposal.files)} satır (sınır ${MAX_FILES}/${MAX_LINES})`,
  });

  const forbidden = proposal.files.filter((file) => !isAllowed(file.path, proposal.kind));
  checks.push({
    name: 'allowed-surface',
    ok: forbidden.length === 0,
    detail: forbidden.length === 0 ? 'yalnız izinli yollar' : `izin dışı: ${forbidden.map((f) => f.path).join(', ')}`,
  });

  // Canonicalisation is not a hidden fix: a call using `./`, `//`, `\` or a letter-case
  // trick is not quietly accepted, it is rejected outright.
  const nonCanonical = proposal.files.filter((file) => normalizePath(file.path) !== file.path);
  checks.push({
    name: 'path-canonical',
    ok: nonCanonical.length === 0,
    detail:
      nonCanonical.length === 0
        ? 'yollar kanonik'
        : `yol kanonik değil: ${nonCanonical.map((f) => f.path).join(', ')}`,
  });

  const secretHit = proposal.files.find((file) => containsSecret(file.after));
  checks.push({
    name: 'no-secrets',
    ok: secretHit === undefined,
    detail: secretHit ? `sır deseni: ${secretHit.path}` : 'sır yok',
  });

  checks.push({
    name: 'no-tests-weakening',
    ok: !proposal.files.some((file) => normalizePath(file.path).startsWith('test/')),
    detail: 'testler korumalı',
  });

  if (proposal.kind === 'code') {
    // Adding a package.json dependency is a human decision.
    checks.push({
      name: 'no-new-deps',
      ok: !proposal.files.some((file) => normalizePath(file.path) === 'package.json'),
      detail: 'package.json teklif edilemez',
    });
  }

  if (opts.runBuild === true && proposal.kind === 'code') {
    checks.push(await compileAndTest(proposal, opts));
  }

  return checks;
}

/**
 * Compile and test in a temporary copy. `node_modules` is linked from the live repo:
 * `npm install` is not run (no network, takes minutes).
 */
async function compileAndTest(proposal: Proposal, opts: CheckOptions): Promise<ProposalCheck> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const dir = join(tmpdir(), `karen-proposal-${randomUUID()}`);
  try {
    mkdirSync(dir, { recursive: true });
    for (const file of proposal.files) {
      const target = join(dir, normalizePath(file.path));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.after, 'utf8');
    }
    // node_modules link: so the tests and tsc can run.
    const modules = join(repoRoot, 'node_modules');
    if (existsSync(modules)) {
      writeFileSync(join(dir, 'package.json'), readFileSync(join(repoRoot, 'package.json'), 'utf8'), 'utf8');
      if (process.platform === 'win32') {
        execFileSyncQuiet('cmd', ['/c', 'mklink', '/J', join(dir, 'node_modules'), modules]);
      } else {
        execFileSyncQuiet('ln', ['-s', modules, join(dir, 'node_modules')]);
      }
    } else {
      return { name: 'build', ok: false, detail: 'node_modules yok: doğrulanamadı (yüksek risk)' };
    }

    const tsc = await runNode(join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), ['--noEmit'], dir, opts.timeoutMs);
    if (!tsc.ok) return { name: 'build', ok: false, detail: `tsc: ${tsc.output.slice(-300)}` };

    const tests = await runNode(
      join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
      ['run'],
      dir,
      opts.timeoutMs ?? 240_000,
    );
    if (!tests.ok) return { name: 'build', ok: false, detail: `test: ${tests.output.slice(-300)}` };

    return { name: 'build', ok: true, detail: 'tsc + test geçti' };
  } catch (err) {
    return { name: 'build', ok: false, detail: `doğrulanamadı: ${(err as Error).message.slice(0, 200)}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function execFileSyncQuiet(command: string, args: string[]): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  try {
    execFileSync(command, args, { stdio: 'ignore', windowsHide: true });
  } catch {
    /* link could not be made: the next step reports it as unverified */
  }
}

function runNode(
  script: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolveRun) => {
    execFile(
      process.execPath,
      [script, ...args],
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolveRun({ ok: !err, output: `${stdout ?? ''}${stderr ?? ''}` });
      },
    );
  });
}

export function riskOf(proposal: Pick<Proposal, 'kind' | 'files'>): ProposalRisk {
  if (proposal.kind === 'identity' || proposal.kind === 'rule' || proposal.kind === 'skill') return 'low';
  if (proposal.kind === 'code') {
    const touchesServer = proposal.files.some((file) => normalizePath(file.path).startsWith('server/'));
    return touchesServer ? 'high' : 'medium';
  }
  return 'high';
}

/** Absolute path under the repo/data root; null if outside the allow-list. */
export function resolveProposalPath(
  path: string,
  kind: ProposalKind,
  opts: { repoRoot: string; dataDir: string },
): string | null {
  const normalized = normalizePath(path);
  // A stored old proposal cannot pass a non-canonical path either: applying goes through a single gate.
  if (normalized === '' || normalized !== path) return null;
  if (!isAllowed(normalized, kind)) return null;
  const root = kind === 'code' ? resolve(opts.repoRoot) : resolve(opts.dataDir);
  const target = resolve(root, normalized);
  if (kind !== 'code') {
    const inside = target === root || target.startsWith(root + sep);
    if (!inside) return null;
  }
  return target;
}
