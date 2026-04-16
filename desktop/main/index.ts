import { app, BrowserWindow, Tray, Menu, shell, nativeImage, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { initConfig, getConfigPath } from './configLoader';
import { registerIpc } from './ipc';
import { registerRenderBridge } from './printDispatcher';

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

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    title: 'VialTrack Print Server',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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
  registerRenderBridge();
  setupAutoLaunch();

  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  createTray();

  if (isDev) {
    createMainWindow();
  }
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
