import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

export const MAX_SKILL_BYTES = 256 * 1024;
export const CATALOG_LIMIT = 200;
// Legacy project dirs stay invisible too.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.karen',
  '.zero', // deprecated: old project dir, read-only fallback
  '.superpowers',
]);

export type ParsedSkill = {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  body: string;
  source: string;
};

export type InstalledSkill = ParsedSkill & {
  enabled: boolean;
  installedAt: number;
  from: string;
};

/** Name → file-system safe identity. */
export function toId(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id === '' ? 'skill' : id.slice(0, 60);
}

function splitFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith('---')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: text };
  const block = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const meta: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) meta[key.toLowerCase()] = value.trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body };
}

export function parseSkill(text: string, source: string, fallbackName: string): ParsedSkill {
  // Windows editors add a BOM; do not let the frontmatter vanish because of the BOM.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const { meta, body } = splitFrontmatter(clean);
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const name = meta['name'] || heading || fallbackName;
  const triggers = (meta['triggers'] ?? meta['trigger'] ?? '')
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t !== '');
  return {
    id: toId(name),
    name,
    description: meta['description'] ?? '',
    triggers,
    body: body.trim(),
    source,
  };
}

function walk(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      files.push(full);
    }
  }
}

/** Finds markdown files in the repo that could count as skills. */
export function discoverSkills(dir: string): ParsedSkill[] {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  const files: string[] = [];
  walk(root, files);

  const skills: ParsedSkill[] = [];
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/').toLowerCase();
    const isSkillPath =
      rel === 'skill.md' || /\/(skill\.md)$/.test(rel) || rel.startsWith('skills/') || rel.startsWith('agents/');
    if (!isSkillPath) continue;
    const size = statSync(file).size;
    if (size > MAX_SKILL_BYTES) continue;
    try {
      const fallback = basename(file).toLowerCase() === 'skill.md' ? basename(dirname(file)) : basename(file, extname(file));
      const skill = parseSkill(readFileSync(file, 'utf8'), file, fallback);
      if (skill.body.trim() === '') continue;
      skills.push(skill);
    } catch {
      // An unreadable file does not crash the app.
    }
  }
  return skills;
}

export class SkillStore {
  constructor(private readonly rootDir: string) {}

  list(): InstalledSkill[] {
    return this.loadIndex().sort((a, b) => a.name.localeCompare(b.name));
  }

  install(sourceDir: string): InstalledSkill[] {
    const found = discoverSkills(sourceDir);
    if (found.length === 0) throw new Error('yetenek bulunamadı');
    const index = this.loadIndex();
    const installed: InstalledSkill[] = [];

    for (const skill of found) {
      const dir = this.dirOf(skill.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), this.render(skill), 'utf8');
      const existing = index.find((s) => s.id === skill.id);
      const record: InstalledSkill = {
        ...skill,
        source: join(dir, 'SKILL.md'),
        enabled: existing?.enabled ?? true,
        installedAt: Date.now(),
        from: resolve(sourceDir),
      };
      if (existing) Object.assign(existing, record);
      else index.push(record);
      installed.push(record);
    }

    this.saveIndex(index);
    return installed;
  }

  async installFromGit(url: string): Promise<InstalledSkill[]> {
    const { execFile } = await import('node:child_process');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const target = mkdtempSync(join(tmpdir(), 'karen-skill-clone-'));
    try {
      await new Promise<void>((resolveClone, reject) => {
        // Without '--' a "URL" starting with '-' could be read as a git option.
        execFile('git', ['clone', '--depth', '1', '--', url, target], { timeout: 120_000 }, (err) =>
          err ? reject(new Error(`git clone failed: ${err.message}`)) : resolveClone(),
        );
      });
      return this.install(target);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }

  setEnabled(id: string, enabled: boolean): boolean {
    if (!isValidId(id)) return false;
    const index = this.loadIndex();
    const record = index.find((s) => s.id === id);
    if (!record) return false;
    record.enabled = enabled;
    this.saveIndex(index);
    return true;
  }

  remove(id: string): boolean {
    if (!isValidId(id)) return false;
    const index = this.loadIndex();
    const next = index.filter((s) => s.id !== id);
    if (next.length === index.length) return false;
    this.saveIndex(next);
    const dir = this.dirOf(id);
    if (this.isInsideRoot(dir)) rmDir(dir);
    return true;
  }

  read(id: string): string | null {
    if (!isValidId(id)) return null;
    const record = this.loadIndex().find((s) => s.id === id && s.enabled);
    if (!record) return null;
    try {
      const text = readFileSync(join(this.dirOf(id), 'SKILL.md'), 'utf8');
      return parseSkill(text, join(this.dirOf(id), 'SKILL.md'), record.name).body;
    } catch {
      return null;
    }
  }

  /** Short list that goes into the system context. The content is untrusted metadata, not instructions. */
  catalog(limit = CATALOG_LIMIT): string[] {
    return this.list()
      .filter((s) => s.enabled)
      .slice(0, limit)
      .map((s) => {
        const triggers = s.triggers.length > 0 ? ` (tetikleyici: ${s.triggers.join(', ')})` : '';
        const description = cleanText(s.description || s.name, 120);
        return `- ${s.id}: ${description}${triggers}`.slice(0, 200);
      });
  }

  private dirOf(id: string): string {
    if (!isValidId(id)) throw new Error(`geçersiz yetenek kimliği: ${id}`);
    return join(this.rootDir, id);
  }

  private isInsideRoot(path: string): boolean {
    const root = resolve(this.rootDir);
    const target = resolve(path);
    return target === root || target.startsWith(root + sep);
  }

  private render(skill: ParsedSkill): string {
    const meta = [
      '---',
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      ...(skill.triggers.length > 0 ? [`triggers: ${skill.triggers.join(', ')}`] : []),
      '---',
      '',
    ].join('\n');
    return meta + skill.body + '\n';
  }

  private indexPath(): string {
    return join(this.rootDir, 'index.json');
  }

  private loadIndex(): InstalledSkill[] {
    if (!existsSync(this.indexPath())) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath(), 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is InstalledSkill =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as InstalledSkill).id === 'string' &&
          isValidId((s as InstalledSkill).id) &&
          typeof (s as InstalledSkill).name === 'string' &&
          typeof (s as InstalledSkill).enabled === 'boolean',
      );
    } catch {
      return [];
    }
  }

  private saveIndex(skills: InstalledSkill[]): void {
    mkdirSync(this.rootDir, { recursive: true });
    const tmp = `${this.indexPath()}.tmp`;
    writeFileSync(tmp, JSON.stringify(skills, null, 2), 'utf8');
    renameSync(tmp, this.indexPath());
  }
}

/** Strips control characters and escape markers from text that goes into the system context. */
function cleanText(text: string, maxLength: number): string {
  return text
    .replace(/[\u0000-\u001f\u007f`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function rmDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function isValidId(id: string): boolean {
  return /^[a-z0-9-]{1,60}$/.test(id);
}
