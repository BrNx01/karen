// Captures the KAREN interface straight from Electron's offscreen renderer.
// No visible window, no desktop session: capturePage() returns real pixels of
// the built app, which is what the README and the site need.
//
// Usage: KAREN_CAPTURE_URL=http://127.0.0.1:PORT/?token=… node scripts/capture.mjs
// (environment, not argv: PowerShell drops arguments containing "?")
import electron from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { app, BrowserWindow } = electron;

const baseUrl = process.env.KAREN_CAPTURE_URL;
const outDir = process.env.KAREN_CAPTURE_OUT ?? 'docs/assets/showcase';
const width = Number(process.env.KAREN_CAPTURE_WIDTH ?? 1440);
const height = Number(process.env.KAREN_CAPTURE_HEIGHT ?? 900);if (!baseUrl) {
  console.error('KAREN_CAPTURE_URL is required');
  process.exit(2);
}

/** Screens in the order the README shows them. `panel` opens a dock panel first. */
const SHOTS = [
  { name: 'cockpit', nav: 'overview' },
  { name: 'cockpit-conversation', nav: 'overview', panel: 'conversation' },
  { name: 'cockpit-system', nav: 'overview', panel: 'system' },
  { name: 'memory', nav: 'memory' },
  { name: 'brain-map', nav: 'map' },
  { name: 'settings', nav: 'settings' },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => writeFileSync(join(outDir, '_capture.log'), `${line}\n`, { flag: 'a' });

// The output directory may not exist yet: create it before the first log line.
mkdirSync(outDir, { recursive: true });
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  writeFileSync(join(outDir, '_capture.log'), `start ${baseUrl}\n`);

  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    backgroundColor: '#08080a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setFrameRate(30);
  win.webContents.on('did-fail-load', (_e, code, desc) => log(`load failed ${code} ${desc}`));

  await win.loadURL(baseUrl);
  log('loaded');
  // The app hydrates from /api/settings, then renders; wait for the rail.
  let railReady = false;
  for (let i = 0; i < 40; i++) {
    railReady = await win.webContents.executeJavaScript("!!document.querySelector('.rail')", true);
    if (railReady) {
      log('rail ready');
      break;
    }
    await wait(250);
  }
  if (!railReady) {
    // Capturing the "interface is not built" placeholder is worse than failing.
    log(`no rail: ${(await win.webContents.executeJavaScript('document.body.innerText.slice(0, 200)', true)) ?? ''}`);
    throw new Error('the interface never rendered');
  }

  // Screenshots are for an English README: force the interface language, not the OS one.
  if (process.env.KAREN_CAPTURE_LOCALE) {
    await win.webContents.executeJavaScript(`
      (async () => {
        const token = new URL(location.href).searchParams.get('token');
        await fetch('/api/settings?token=' + token, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale: ${JSON.stringify(process.env.KAREN_CAPTURE_LOCALE)} }),
        });
        location.reload();
        return true;
      })()
    `, true);
    await wait(1500);
    for (let i = 0; i < 40; i++) {
      const ready = await win.webContents.executeJavaScript("!!document.querySelector('.rail')", true);
      if (ready) break;
      await wait(250);
    }
  }

  for (const shot of SHOTS) {
    const clicked = await win.webContents.executeJavaScript(`
      (() => {
        const target = document.querySelector('[data-screen="${shot.nav}"]');
        if (!target) return false;
        target.click();
        return true;
      })()
    `, true);
    if (!clicked) throw new Error(`no rail item for ${shot.nav}`);
    await wait(900);

    // A dock panel is opened deliberately: the README shows both the empty stage
    // and the stage with a panel out, because that difference is the point.
    if (shot.panel) {
      await win.webContents.executeJavaScript(`
        (() => {
          const item = document.querySelector('[data-panel="${shot.panel}"]');
          if (!item) return false;
          item.click();
          return true;
        })()
      `, true);
      await wait(700);
    }

    const image = await win.webContents.capturePage();
    const file = join(outDir, `${shot.name}.png`);
    writeFileSync(file, image.toPNG());
    log(`${file} ${image.getSize().width}x${image.getSize().height}`);

    if (shot.panel) {
      // Close it again so the next shot starts from the empty stage.
      await win.webContents.executeJavaScript(`
        (() => {
          document.querySelector('.panel-close')?.click();
          return true;
        })()
      `, true);
      await wait(300);
    }
  }

  win.destroy();
  app.quit();
}).catch((err) => {
  writeFileSync(join(outDir, '_capture.log'), `error ${err?.stack ?? err}\n`, { flag: 'a' });
  app.quit();
});
