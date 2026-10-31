// electron-updater wrapper: updates from GitHub Releases.
// Runs only in the packaged app (there is no installation to update in dev).
const { app, dialog, Notification } = require('electron');

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

function setupUpdater({ onStatus } = {}) {
  if (!app.isPackaged) return { check: () => Promise.resolve({ skipped: 'dev' }) };

  let autoUpdater;
  try {
    // eslint-disable-next-line global-require
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    return { check: () => Promise.resolve({ error: `no updater: ${err.message}` }) };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Signature checks cannot run on unsigned builds; install still needs user approval.
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('update-available', (info) => {
    notify('KAREN update available', `downloading ${info.version}…`);
    onStatus?.({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => onStatus?.({ state: 'current' }));
  autoUpdater.on('download-progress', (progress) => {
    onStatus?.({ state: 'downloading', percent: Math.round(progress.percent) });
  });
  autoUpdater.on('error', (err) => {
    onStatus?.({ state: 'error', message: err?.message ?? String(err) });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    onStatus?.({ state: 'ready', version: info.version });
    const answer = await dialog.showMessageBox({
      type: 'info',
      title: 'KAREN update ready',
      message: `${info.version} has been downloaded. Restart now?`,
      detail: 'If you do not restart, the update installs when you quit the app.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
  });

  const check = async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, version: result?.updateInfo?.version };
    } catch (err) {
      onStatus?.({ state: 'error', message: err?.message ?? String(err) });
      return { error: err?.message ?? String(err) };
    }
  };

  // Silent check 12 s after startup, then every 6 hours.
  setTimeout(() => void check(), 12_000);
  setInterval(() => void check(), 6 * 60 * 60 * 1000);

  return { check, autoUpdater };
}

module.exports = { setupUpdater };
