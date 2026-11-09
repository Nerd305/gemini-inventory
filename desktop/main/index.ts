import { app, BrowserWindow, Tray, Menu, shell, nativeImage, Notification, powerSaveBlocker } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { initConfig, getConfigPath } from './configLoader';
import { registerIpc } from './ipc';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuittingForReal = false;

function getRendererPath(): string {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  return path.join(__dirname, '..', 'renderer', 'index.html');
}

/**
 * The print queue runs in this window's renderer, so the window must exist even when nobody is
 * looking at it: at login it is created hidden, and closing it only hides it.
 */
function createMainWindow(show = true) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (show) {
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }

  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    show,
    title: 'VialTrack Print Server',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Hidden windows get their timers throttled; the queue's retry timer must keep running.
      backgroundThrottling: false,
    },
  });

  // A crashed or hung renderer would silently stop printing: reload it.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] Renderer gone, reloading in 3 s:', details.reason);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 3000);
  });
  mainWindow.on('unresponsive', () => {
    console.error('[main] Renderer unresponsive, reloading');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const rendererPath = getRendererPath();
    console.log('[main] Loading renderer from:', rendererPath);
    mainWindow.loadFile(rendererPath).catch((err) => {
      console.error('[main] Failed to load renderer:', err);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[main] Renderer failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) { // Warning or error
      console.log(`[renderer ${level}]`, message);
    }
  });

  mainWindow.on('close', (e) => {
    if (isQuittingForReal) return;
    e.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getTrayIcon(): Electron.NativeImage {
  const tryLoadIcon = (iconPath: string): Electron.NativeImage | null => {
    if (fs.existsSync(iconPath)) {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        return icon;
      }
    }
    return null;
  };

  let icon: Electron.NativeImage | null = null;

  if (isDev) {
    icon = tryLoadIcon(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
  } else {
    icon = tryLoadIcon(path.join(process.resourcesPath!, '..', 'Frameworks', 'Electron Framework.framework', 'Resources', 'icon.icns'));
  }

  if (!icon) {
    icon = tryLoadIcon(path.join(process.resourcesPath!, 'icon.icns'));
  }

  if (!icon) {
    icon = nativeImage.createFromNamedImage('NSStatusAvailable', [-1, 0, 1]);
  }

  return icon;
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show Window', click: () => createMainWindow() },
    { label: 'Printers & Scanners…', click: () => void shell.openExternal('x-apple.systempreferences:com.apple.Print-Scanner-Settings.extension') },
    { type: 'separator' },
    {
      label: 'Open printers.json',
      click: () => {
        const p = getConfigPath();
        if (p) shell.openPath(p);
      },
    },
    {
      label: 'Open Logs Folder',
      click: () => shell.openPath(app.getPath('logs')),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuittingForReal = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('VialTrack Print Server');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => createMainWindow());
}

function setupLogging() {
  const logDir = app.getPath('logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'print-server.log');
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  const write = (level: string, args: unknown[]) => {
    const line = `[${new Date().toISOString()}] [${level}] ${args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')}\n`;
    stream.write(line);
  };
  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  console.log = (...args: unknown[]) => {
    origLog(...args);
    write('info', args);
  };
  console.error = (...args: unknown[]) => {
    origErr(...args);
    write('error', args);
  };
}

function setupAutoLaunch() {
  if (isDev) return;
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
  });
}

function notifyIfSingleInstance() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => createMainWindow());
  return true;
}

app.whenReady().then(() => {
  if (!notifyIfSingleInstance()) return;

  try {
    setupLogging();
  } catch (e) {
    console.error('Failed to set up logging:', e);
  }

  initConfig();
  registerIpc();
  setupAutoLaunch();
  // Keep macOS App Nap from suspending the print server while it sits in the menu bar.
  powerSaveBlocker.start('prevent-app-suspension');

  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  createTray();

  // Always start the queue; show the window only when developing.
  createMainWindow(isDev);
});

app.on('window-all-closed', () => {
  // Keep app alive in background; tray controls lifecycle.
});

app.on('activate', () => {
  createMainWindow();
});

app.on('before-quit', () => {
  isQuittingForReal = true;
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
  new Notification({
    title: 'VialTrack Print Server',
    body: `Unexpected error: ${err.message}`,
  }).show();
});
