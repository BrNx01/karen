// Electron main process.
// The server runs in a separate Node process (so the native module ABI stays intact
// and sleep can keep running after close). The window opens the tokenised URL.
const { app, BrowserWindow, Menu, Tray, Notification, dialog, nativeImage, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { setupUpdater } = require('./updater.cjs');

let win = null;
let tray = null;
let child = null;
let serverUrl = null;
let quitting = false;
let sleeping = false;
let updater = null;

const appRoot = () => (app.isPackaged ? app.getAppPath() : path.join(__dirname, '..'));
const workDir = () => (app.isPackaged ? path.dirname(process.execPath) : appRoot());

/**
 * UI files sit outside the archive in the package (app.asar.unpacked): the server
 * cannot serve files from inside the asar. In development the repo root is used.
 */
const staticRoot = () => (app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : appRoot());
const dataDir = () => path.join(app.getPath('userData'), 'karen-data');
const cliEntry = () => path.join(appRoot(), 'dist', 'server', 'cli.js');

/**
 * Carries a pre-rename desktop profile over on first run: memory, event log and settings
 * live there. The old folder is copied, never moved or deleted, so nothing is lost if the
 * copy fails or the user goes back.
 */
function migrateLegacyData() {
  const target = dataDir();
  const legacy = path.join(app.getPath('appData'), 'ZERO', 'zero-data'); // legacy: pre-rename profile
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return;
  try {
    fs.cpSync(legacy, target, { recursive: true, force: false, errorOnExist: false });
  } catch {
    // A failed copy is not fatal: the app starts with a fresh profile.
  }
}

/** A packaged app has no node: run Electron in pure node mode. */
function nodeCommand() {
  return app.isPackaged ? process.execPath : process.env.KAREN_NODE || 'node';
}

function nodeEnv() {
  const env = { ...process.env };
  if (app.isPackaged) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

function startServer() {
  migrateLegacyData();
  return new Promise((resolve, reject) => {
    child = spawn(
      nodeCommand(),
      [cliEntry(), 'serve', '--port', '0', '--data', dataDir(), '--root', staticRoot()],
      {
        cwd: workDir(),
        env: nodeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let buffer = '';
    const timer = setTimeout(() => reject(new Error('the server did not start within 20 s')), 20_000);

    // If node is not on PATH (unpacked run) the process never starts: error instead of a silent crash.
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`the server could not start: ${err.message}`));
    });

    child.stdout.on('data', (chunk) => {
      buffer = tail(buffer + chunk.toString());
      const match = /KAREN ready: (\S+)/.exec(buffer);
      if (match && !serverUrl) {
        serverUrl = match[1];
        clearTimeout(timer);
        resolve(serverUrl);
      }
    });

    child.stderr.on('data', (chunk) => {
      buffer = tail(buffer + chunk.toString());
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!serverUrl) reject(new Error(`the server exited (code ${code}): ${buffer.slice(-400)}`));
      else if (!quitting) {
        dialog.showErrorBox('The KAREN server stopped', buffer.slice(-600) || `exit code ${code}`);
        quitting = true;
        app.quit();
      }
    });
  });
}

/** Keep the log buffer from growing without bound. */
function tail(text, limit = 8192) {
  return text.length > limit ? text.slice(-limit) : text;
}

/** Sleep runs in a separate process: the work finishes even if the window closes. */
function runSleep(options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(nodeCommand(), [cliEntry(), 'sleep', '--data', dataDir()], {
      cwd: workDir(),
      env: nodeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: options.detached === true,
    });
    let out = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // If sleep hangs, the process must not stay invisible.
    const timer = setTimeout(() => {
      if (!options.detached) proc.kill();
      finish('timeout');
    }, 120_000);

    proc.stdout.on('data', (chunk) => (out += chunk.toString()));
    proc.on('exit', () => finish(out));
    proc.on('error', () => finish('error'));
    if (options.detached) {
      proc.unref();
      finish('detached');
    }
  });
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#08080a',
    title: 'KAREN',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  void win.loadURL(url);

  // External navigation is blocked: the window only shows our own server.
  win.webContents.on('will-navigate', (event, target) => {
    if (!serverUrl || !target.startsWith(new URL(serverUrl).origin)) event.preventDefault();
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    // Only http(s) opens externally; file:, ms-*, search-ms: and UNC paths are rejected.
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(target);
    } catch {
      /* invalid URL: ignore */
    }
    return { action: 'deny' };
  });

  // Close = minimise to tray; quit once sleep finishes.
  win.on('close', (event) => {
    if (quitting) return;
    // With no tray, hiding would strand the window: quit directly.
    if (!tray) {
      quitting = true;
      void runSleep({ detached: true });
      return;
    }
    event.preventDefault();
    win.hide();
    void sleepThenQuit();
  });
}

async function sleepThenQuit() {
  if (sleeping) return;
  sleeping = true;
  notify('KAREN is consolidating memory', 'It will quit when done.');
  await runSleep();
  sleeping = false;
  // If the user reopened the window during sleep, do not quit.
  if (win && win.isVisible()) {
    notify('KAREN', 'Consolidation finished; the app stays open.');
    return;
  }
  quitting = true;
  app.quit();
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  } catch {
    return;
  }
  tray.setToolTip('KAREN');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open KAREN',
        click: () => {
          win?.show();
          win?.focus();
        },
      },
      {
        label: 'Consolidate memory (sleep)',
        click: async () => {
          const out = await runSleep();
          const match = /"notesAdded":\s*(\d+)/.exec(out);
          notify('Sleep finished', match ? `${match[1]} new notes` : 'done');
        },
      },
      {
        label: 'Check for updates',
        click: async () => {
          const result = await updater?.check?.();
          if (result?.error) notify('Update', `check failed: ${result.error}`);
          else if (result?.skipped) notify('Update', 'a source checkout is updated by hand');
          else notify('Update', result?.version ? `version ${result.version}` : 'up to date');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit completely',
        click: () => {
          // On a full quit, sleep keeps running in a separate process.
          void runSleep({ detached: true });
          quitting = true;
          child?.kill();
          child = null;
          app.quit();
        },
      },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    } else {
      // Second call while startup is still running: raise once the window is ready.
      app.once('browser-window-created', () => {
        win?.show();
        win?.focus();
      });
    }
  });

  app.whenReady().then(async () => {
    try {
      const url = await startServer();
      createWindow(url);
      createTray();
      updater = setupUpdater();
    } catch (err) {
      dialog.showErrorBox('KAREN could not start', String(err?.message ?? err));
      quitting = true;
      child?.kill();
      app.quit();
    }
  });

  // The process lives on until sleep finishes, even when the window is closed.
  app.on('window-all-closed', () => undefined);

  app.on('before-quit', () => {
    quitting = true;
  });

  // The server child process must not be left orphaned.
  app.on('will-quit', () => {
    quitting = true;
    child?.kill();
    child = null;
  });
}
