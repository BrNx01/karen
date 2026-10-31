import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RepoStore } from '../server/repos.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'karen-repos-')), 'repos.json');

describe('RepoStore', () => {
  it('returns an empty list for a corrupt file', () => {
    const path = file();
    writeFileSync(path, '{bozuk', 'utf8');
    expect(new RepoStore(path).list()).toEqual([]);
    // must be able to overwrite a corrupt file
    expect(new RepoStore(path).add('C:\\work\\a').name).toBe('a');
  });

  it('adds, lists and removes', () => {
    const store = new RepoStore(file());
    const repo = store.add('C:\\work\\proje');
    expect(repo.name).toBe('proje');
    expect(store.list()).toHaveLength(1);
    expect(store.remove(repo.id)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.remove('yok')).toBe(false);
  });

  it('does not add the same path twice and writes to disk', () => {
    const path = file();
    const store = new RepoStore(path);
    const a = store.add('C:\\work\\proje');
    const b = store.add('C:\\work\\proje');
    expect(b.id).toBe(a.id);
    expect(store.list()).toHaveLength(1);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(1);
  });
});
