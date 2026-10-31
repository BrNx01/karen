import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Files the desktop shell expects: the Electron main process loads
 * them from fixed paths, so a rename silently breaks the app.
 */
describe('desktop paths', () => {
  it('electron main process and package output are in place', () => {
    expect(existsSync(join(process.cwd(), 'electron', 'main.cjs'))).toBe(true);
  });

  it('the builder config includes the compiled server and the UI', async () => {
    const pkg = (await import('../package.json', { with: { type: 'json' } })).default as {
      main: string;
      build: { files: string[]; asarUnpack: string[] };
      scripts: Record<string, string>;
    };
    expect(pkg.main).toBe('electron/main.cjs');
    expect(pkg.build.files).toContain('dist/**/*');
    expect(pkg.build.files).toContain('app/dist/**/*');
    expect(pkg.build.asarUnpack.join(' ')).toContain('better-sqlite3');
  });

  it('build output keeps the electron/serve path', () => {
    // with tsc rootDir=server, dist/server/cli.js would not exist and Electron would not start.
    // a clean clone has no dist; then we validate the configuration.
    if (existsSync(join(process.cwd(), 'dist', 'server', 'cli.js'))) {
      expect(existsSync(join(process.cwd(), 'dist', 'server', 'cli.js'))).toBe(true);
      return;
    }
    const config = require('node:fs').readFileSync(join(process.cwd(), 'tsconfig.build.json'), 'utf8');
    expect(config).toContain('"rootDir": "."');
  });

  it('the server starts from the compiled output', async () => {
    if (!existsSync(join(process.cwd(), 'dist', 'server', 'serve.js'))) return; // derleme yok: atla
    const modulePath = '../dist/server/serve.js';
    // the build output has no type files; dynamic loading is enough in the test.
    const { startKarenServer } = (await import(modulePath)) as {
      startKarenServer: (opts: unknown) => Promise<{ port(): number | null; token: string; close(): Promise<void> }>;
    };
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const server = await startKarenServer({ dataDir: mkdtempSync(join(tmpdir(), 'karen-dist-')) });
    const port = server.port();
    expect(port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    await server.close();
  });

  it('serves the UI from the given rootDir', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');

    const root = mkdtempSync(join(tmpdir(), 'karen-root-'));
    mkdirSync(join(root, 'app', 'dist'), { recursive: true });
    writeFileSync(join(root, 'app', 'dist', 'index.html'), '<title>KAREN-PAKET</title>', 'utf8');

    const { startKarenServer: start } = (await import('../server/serve.js')) as typeof import('../server/serve.js');
    const server = await start({
      dataDir: mkdtempSync(join(tmpdir(), 'karen-packdata-')),
      rootDir: root,
    });
    const html = await (await fetch(`http://127.0.0.1:${server.port()}/`)).text();
    expect(html).toContain('KAREN-PAKET');
    await server.close();
  });
});
