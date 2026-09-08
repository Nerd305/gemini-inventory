import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface FormatConfig {
  cupsPrinter: string;
  pageSize: { widthIn: number; heightIn: number };
  margins: { top: number; right: number; bottom: number; left: number };
  stickyRegion?: { xIn: number; yIn: number; widthIn: number; heightIn: number };
  lpOptions: string[];
}

export interface PrintersConfig {
  formats: Record<string, FormatConfig>;
}

const DEFAULT_CONFIG: PrintersConfig = {
  formats: {
    '4x3': {
      cupsPrinter: 'Zebra_ZD410',
      pageSize: { widthIn: 4, heightIn: 3 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      lpOptions: ['-o', 'media=Custom.4x3in', '-o', 'fit-to-page'],
    },
    '2x1.5': {
      cupsPrinter: 'EPSON_C6000',
      pageSize: { widthIn: 2, heightIn: 1.5 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      lpOptions: ['-o', 'media=Custom.2x1.5in'],
    },
    '2.5x0.7': {
      cupsPrinter: 'EPSON_C6000',
      pageSize: { widthIn: 2.5, heightIn: 0.7 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      lpOptions: ['-o', 'media=Custom.2.5x0.7in'],
    },
    '2.5x1.5': {
      cupsPrinter: 'EPSON_C6000',
      pageSize: { widthIn: 2.5, heightIn: 1.5 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      lpOptions: ['-o', 'media=Custom.2.5x1.5in'],
    },
    '1.5x1.5': {
      cupsPrinter: 'EPSON_C6000',
      pageSize: { widthIn: 1.5, heightIn: 1.5 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      lpOptions: ['-o', 'media=Custom.1.5x1.5in'],
    },
    'canon-integrated': {
      cupsPrinter: 'Canon',
      pageSize: { widthIn: 8.5, heightIn: 11 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      stickyRegion: { xIn: 1.25, yIn: 6.5, widthIn: 6, heightIn: 4 },
      lpOptions: ['-o', 'media=Letter'],
    },
  },
};

type Listener = (config: PrintersConfig) => void;

let currentConfig: PrintersConfig = DEFAULT_CONFIG;
let configPath: string | null = null;
let watcher: fs.FSWatcher | null = null;
const listeners = new Set<Listener>();

function resolveConfigPath(): string {
  const devPath = path.join(__dirname, '..', '..', 'config', 'printers.json');
  if (fs.existsSync(devPath)) return devPath;

  const userDataPath = path.join(app.getPath('userData'), 'printers.json');
  return userDataPath;
}

function readConfig(filePath: string): PrintersConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as PrintersConfig;
  if (!parsed.formats || typeof parsed.formats !== 'object') {
    throw new Error('Invalid printers.json: missing "formats" object');
  }
  return parsed;
}

function ensureConfigFile(filePath: string): void {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
}

export function initConfig(): PrintersConfig {
  configPath = resolveConfigPath();
  ensureConfigFile(configPath);
  try {
    currentConfig = readConfig(configPath);
  } catch (e) {
    console.error('Failed to read printers.json, falling back to defaults:', e);
    currentConfig = DEFAULT_CONFIG;
  }

  if (watcher) watcher.close();
  watcher = fs.watch(configPath, { persistent: false }, (event) => {
    if (event !== 'change') return;
    try {
      const next = readConfig(configPath!);
      currentConfig = next;
      listeners.forEach((l) => l(next));
      console.log('printers.json reloaded');
    } catch (e) {
      console.error('Failed to reload printers.json:', e);
    }
  });

  return currentConfig;
}

export function getConfig(): PrintersConfig {
  return currentConfig;
}

export function getConfigPath(): string | null {
  return configPath;
}

export function onConfigChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveConfig(config: PrintersConfig): void {
  if (!configPath) {
    throw new Error('Config not initialized');
  }
  const json = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, json, 'utf-8');
  currentConfig = config;
  listeners.forEach((l) => l(config));
}
