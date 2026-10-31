import { resolveInside } from './tools/types.js';

export type PermissionClass = 'simple' | 'important';

export type PermissionRequest = {
  tool: string;
  access: 'read' | 'write' | 'exec';
  args: Record<string, unknown>;
  cwd: string;
};

export type Classification = { class: PermissionClass; reason: string };

export type AutonomousVerdict = { allow: boolean; decision: 'auto-autonomous' | 'denied-autonomous' };

/** Fate of a call that needs approval in an autonomous session. Network tools depend on research permission. */
export function autonomousVerdict(tool: string, research: boolean): AutonomousVerdict {
  if (tool === 'fetch_url' || tool === 'web_search') {
    return research ? { allow: true, decision: 'auto-autonomous' } : { allow: false, decision: 'denied-autonomous' };
  }
  // Safety net: even an unregistered tool cannot wait for approval in autonomous mode.
  return { allow: false, decision: 'denied-autonomous' };
}

export type Approver = { ask(req: PermissionRequest): Promise<boolean> };

export const autoApprover = (): Approver => ({ ask: async () => true });
export const denyApprover = (): Approver => ({ ask: async () => false });

/** Only informational commands with no side effects are auto-approved. */
const SAFE_COMMANDS = new Set(['ls', 'dir', 'cat', 'type', 'echo', 'rg', 'find', 'pwd', 'head', 'tail', 'wc']);
const SAFE_GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'branch', 'remote', 'rev-parse', 'ls-files']);

const DANGEROUS_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\brm\b/i, label: 'rm' },
  { re: /\bdel\b/i, label: 'del' },
  { re: /rmdir|\brd\b/i, label: 'rmdir' },
  { re: /reset --hard/i, label: 'git reset --hard' },
  { re: /push (--force|-f)\b/i, label: 'force push' },
  { re: /--no-verify/i, label: '--no-verify' },
  { re: /\bformat\b/i, label: 'format' },
  { re: /\breg\b/i, label: 'reg' },
  { re: /\bnetsh\b/i, label: 'netsh' },
  { re: /\bschtasks\b/i, label: 'schtasks' },
  { re: /\bshutdown\b/i, label: 'shutdown' },
  { re: /\bpublish\b/i, label: 'publish' },
  { re: /\|\s*(bash|sh|powershell|pwsh)\b/i, label: 'pipe to shell' },
  { re: /&&|\|\||;|\$\(|`/, label: 'command chaining' },
  { re: />\s*[A-Za-z]:\\/, label: 'redirect to absolute path' },
];

export function classify(req: PermissionRequest): Classification {
  // Network tools leave the machine even when reading: they need approval.
  if (req.tool === 'fetch_url' || req.tool === 'web_search') return { class: 'important', reason: 'network' };

  if (req.access === 'read') return { class: 'simple', reason: 'read' };

  if (req.access === 'write') {
    const path = typeof req.args['path'] === 'string' ? req.args['path'] : '';
    // A write tool without a path (e.g. clipboard write) cannot count as inside the root: it needs approval.
    if (path.trim() === '') return { class: 'important', reason: 'write without path' };
    return resolveInside(req.cwd, path) === null
      ? { class: 'important', reason: 'outside cwd' }
      : { class: 'simple', reason: 'inside cwd' };
  }

  const command = String(req.args['command'] ?? '');
  const danger = DANGEROUS_PATTERNS.find((p) => p.re.test(command));
  if (danger) return { class: 'important', reason: `dangerous: ${danger.label}` };

  const first = command.trim().split(/\s+/)[0]?.replace(/^\.\//, '') ?? '';
  if (first && SAFE_COMMANDS.has(first)) return { class: 'simple', reason: 'safe command' };
  if (first === 'git') {
    const sub = command.trim().split(/\s+/)[1] ?? '';
    if (SAFE_GIT_SUBCOMMANDS.has(sub)) return { class: 'simple', reason: 'safe git command' };
    return { class: 'important', reason: `git ${sub || '(no subcommand)'}` };
  }
  return { class: 'important', reason: 'unknown command' };
}
