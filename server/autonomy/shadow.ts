import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fold, type MemoryStore } from '../memory/notes.js';
import { projectKey } from '../project.js';
import { normalizeInboxText } from './inbox.js';

export type ShadowReport = { repo: string; found: string[]; missing: string[]; line: string };

/** Tool label → the manifest that proves it. */
const MANIFEST_TOOLS: { file: string; tools: string[] }[] = [
  { file: 'package.json', tools: ['node', 'npm'] },
  { file: 'Cargo.toml', tools: ['rust', 'cargo'] },
  { file: 'go.mod', tools: ['go'] },
  { file: 'requirements.txt', tools: ['python'] },
];

/** No glob library: just "is there a file in the folder whose name ends with `.csproj`". */
const CSPROJ_TOOLS = ['dotnet'];

/** Tool names looked up in memory notes. */
const TOOL_WORDS = ['node', 'npm', 'rust', 'cargo', 'go', 'python', 'dotnet'];
const MAX_KNOWN = 8;

/**
 * Shadow mode: read only. It inspects manifests, runs no command, writes no
 * file, installs nothing.
 * `readFile` takes a manifest name (not a full path); if absent it reads from the repo folder.
 */
export function shadowReport(input: {
  repoPath: string;
  known: string[];
  readFile?: (p: string) => string | null;
}): ShadowReport {
  const read = input.readFile ?? defaultReadFile(input.repoPath);
  const present = new Set<string>();

  for (const manifest of MANIFEST_TOOLS) {
    const content = safeRead(read, manifest.file);
    if (content === null) continue;
    // Broken JSON is swallowed: the file's existence counts as evidence, a read error does not break the flow.
    if (manifest.file.endsWith('.json')) {
      try {
        JSON.parse(content);
      } catch {
        // swallowed
      }
    }
    for (const tool of manifest.tools) present.add(tool);
  }
  if (hasCsproj(input.repoPath)) for (const tool of CSPROJ_TOOLS) present.add(tool);

  const known = [...new Set(input.known.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== ''))];
  const found = known.filter((tag) => present.has(tag));
  const missing = known.filter((tag) => !present.has(tag));

  return {
    repo: projectKey(input.repoPath),
    found,
    missing,
    line: summaryLine(known, missing),
  };
}

/**
 * Extracts "required in this repo" tool tags from project notes (deterministic):
 * `concepts` + tool names appearing in the note text, deduped, at most 8.
 */
export function knownRequirements(memory: MemoryStore, repoPath: string): string[] {
  const key = projectKey(repoPath);
  const tags = new Set<string>();
  for (const note of memory.list()) {
    // Notes are written with the full project key; a note written with a short tag must match too.
    if (note.project !== key && note.project !== repoPath) continue;
    if (tags.size >= MAX_KNOWN) break;
    for (const concept of note.concepts) {
      const tag = concept.trim().toLowerCase();
      if (TOOL_WORDS.includes(tag)) tags.add(tag);
    }
    const words = new Set(fold(note.text).split(' '));
    for (const tool of TOOL_WORDS) if (words.has(tool)) tags.add(tool);
  }
  return [...tags].slice(0, MAX_KNOWN);
}

function summaryLine(known: string[], missing: string[]): string {
  if (known.length === 0) return 'No known requirements yet; manifests inspected read-only.';
  if (missing.length === 0) return normalizeInboxText(`${known.length} requirements ready: ${known.join(', ')}`);
  return normalizeInboxText(`${known.length} requirements: ${known.map((tag) => `${tag} ${missing.includes(tag) ? 'missing' : 'ready'}`).join(', ')}`);
}

/** Default reader: missing / no permission / path is a directory — all `null`, never throws. */
function defaultReadFile(repoPath: string): (p: string) => string | null {
  return (name) => {
    try {
      return readFileSync(join(repoPath, name), 'utf8');
    } catch {
      return null;
    }
  };
}

function safeRead(read: (p: string) => string | null, name: string): string | null {
  try {
    const content = read(name);
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

function hasCsproj(repoPath: string): boolean {
  try {
    return readdirSync(repoPath).some((name) => name.toLowerCase().endsWith('.csproj'));
  } catch {
    return false;
  }
}
