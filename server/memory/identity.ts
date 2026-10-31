import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_IDENTITY_CHARS = 8000;

export const CORE_RELATIVE_PATH = 'brain/core/core_identity.md';

/**
 * Core text; it is fixed, the model/user cannot change it.
 * It is a character sheet, not a task list: tone and limits are pinned here.
 */
export const CORE_IDENTITY = [
  '# KAREN — core identity',
  '',
  "You are KAREN: the user's second brain and most capable assistant.",
  '',
  '- You are rational; evidence speaks, not emotion. You say what you do not know; you never invent.',
  '- You are loyal; you put the user\'s interest ahead of your own visibility.',
  '- You are hyper-competent; you finish the work and make no excuses.',
  '- No panic, no flattery. You speak calmly, briefly and clearly.',
  '- No claim without evidence; when unsure, you state the uncertainty plainly.',
  '- You never make irreversible decisions on the user\'s behalf; you ask first.',
].join('\n');

// Windows has a different permission model: swallow chmod errors so the app keeps running.
function tryChmod(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    /* permission could not be changed */
  }
}

/** Writes if missing, rewrites if the content differs. Leaves the file alone when identical (no disk churn). */
export function ensureCore(dataDir: string): void {
  const path = join(dataDir, ...CORE_RELATIVE_PATH.split('/'));
  const expected = `${CORE_IDENTITY}\n`;
  try {
    if (!existsSync(path)) {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, expected, { encoding: 'utf8', mode: 0o444 });
      return;
    }
    if (readFileSync(path, 'utf8') === expected) return;
    tryChmod(path, 0o644);
    writeFileSync(path, expected, 'utf8');
    tryChmod(path, 0o444);
  } catch {
    // The path may be a directory or ACLs may be closed: the app must start even without a core.
  }
}

const DEFAULT_IDENTITY = [
  '# Identity',
  '',
  'You are KAREN. The user\'s second brain.',
  '',
  '- Speak briefly and clearly. No unnecessary praise.',
  '- Say what you do not know; do not invent.',
  '- State the source of what you remember.',
  '- Before an important action, say in one sentence what you are about to do.',
].join('\n');

const DEFAULT_RULES = [
  '# Behavior rules',
  '',
  '- Do not write outside the project root; ask for permission when needed.',
  '- Never write secrets (keys, passwords) anywhere.',
  '- Summarize long output; do not fill the context with raw dumps.',
].join('\n');

/**
 * Identity and behavior rules live on disk; the same person remains even if the model/API changes.
 * The user may edit these files by hand. Defaults are created when missing.
 */
export function ensureIdentity(dataDir: string): void {
  ensureCore(dataDir);
  const identityDir = join(dataDir, 'brain', 'identity');
  const files: [string, string][] = [
    // Legacy: profiles used to carry 'zero.md'; it is still read, just not created.
    [join(identityDir, 'karen.md'), DEFAULT_IDENTITY],
    [join(dataDir, 'brain', 'rules', 'temel.md'), DEFAULT_RULES],
  ];
  const legacy = join(identityDir, 'zero.md');
  for (const [path, content] of files) {
    if (existsSync(path)) continue;
    if (path.endsWith('karen.md') && existsSync(legacy)) continue;
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${content}\n`, 'utf8');
  }
}

export function loadIdentity(dataDir: string): string {
  ensureIdentity(dataDir);
  const parts: string[] = [];
  // The core is always the first part; then the user identity, then the rules.
  try {
    const core = readFileSync(join(dataDir, ...CORE_RELATIVE_PATH.split('/')), 'utf8').trim();
    if (core !== '') parts.push(core);
  } catch {
    // identity still loads even if the core cannot be read
  }
  for (const dir of [join(dataDir, 'brain', 'identity'), join(dataDir, 'brain', 'rules')]) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).sort();
    for (const file of files) {
      try {
        const text = readFileSync(join(dir, file), 'utf8').trim();
        if (text !== '') parts.push(text);
      } catch {
        // an unreadable file does not bring the app down
      }
    }
  }
  return parts.join('\n\n').slice(0, MAX_IDENTITY_CHARS);
}
