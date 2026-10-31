import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

export type Repo = { id: string; name: string; path: string };

function idOf(path: string): string {
  return createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 8);
}

export class RepoStore {
  constructor(private readonly filePath: string) {}

  list(): Repo[] {
    return this.load();
  }

  add(path: string, name?: string): Repo {
    const repos = this.load();
    const id = idOf(path);
    const existing = repos.find((r) => r.id === id);
    if (existing) return existing;
    const repo: Repo = { id, name: name?.trim() || basename(path) || path, path };
    repos.push(repo);
    this.save(repos);
    return repo;
  }

  remove(id: string): boolean {
    const repos = this.load();
    const next = repos.filter((r) => r.id !== id);
    if (next.length === repos.length) return false;
    this.save(next);
    return true;
  }

  private load(): Repo[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (r): r is Repo =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as Repo).id === 'string' &&
          typeof (r as Repo).name === 'string' &&
          typeof (r as Repo).path === 'string',
      );
    } catch {
      // A corrupt file does not crash the app; the first write overwrites it.
      return [];
    }
  }

  private save(repos: Repo[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(repos, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }
}
