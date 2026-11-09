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

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

/**
 * Check one format entry and fill gaps from `fallback`. Throws with a readable message on values
 * that would make `lp` misbehave (non-string options, absurd page sizes).
 */
function cleanFormat(key: string, value: unknown, fallback?: FormatConfig): FormatConfig {
  if (!value || typeof value !== 'object') {
    if (fallback) return fallback;
    throw new Error(`printers.json: "${key}" must be an object`);
  }
  const v = value as Partial<FormatConfig>;
  const cupsPrinter = typeof v.cupsPrinter === 'string' ? v.cupsPrinter.trim().slice(0, 127) : fallback?.cupsPrinter ?? '';
  if (/[\s/#]/.test(cupsPrinter)) throw new Error(`printers.json: "${key}".cupsPrinter "${cupsPrinter}" is not a CUPS queue name (no spaces, / or #)`);
  const w = num(v.pageSize?.widthIn, 0.2, 20) ?? fallback?.pageSize.widthIn;
  const h = num(v.pageSize?.heightIn, 0.2, 20) ?? fallback?.pageSize.heightIn;
  if (!w || !h) throw new Error(`printers.json: "${key}".pageSize needs widthIn and heightIn in inches`);
  const lpOptions = v.lpOptions ?? fallback?.lpOptions ?? [];
  if (!Array.isArray(lpOptions) || lpOptions.some((o) => typeof o !== 'string' || o.length > 200)) {
    throw new Error(`printers.json: "${key}".lpOptions must be a list of strings, e.g. ["-o", "media=Custom.2.5x1.5in"]`);
  }
  const r = v.stickyRegion ?? fallback?.stickyRegion;
  const stickyRegion =
    r && [r.xIn, r.yIn, r.widthIn, r.heightIn].every((n) => num(n, 0, 20) !== null) ? { xIn: r.xIn, yIn: r.yIn, widthIn: r.widthIn, heightIn: r.heightIn } : undefined;
  return {
    cupsPrinter,
    pageSize: { widthIn: w, heightIn: h },
    margins: v.margins ?? fallback?.margins ?? { top: 0, right: 0, bottom: 0, left: 0 },
    ...(stickyRegion ? { stickyRegion } : {}),
    lpOptions: lpOptions.map((o) => o.trim()).filter(Boolean),
  };
}

/** Validate a whole config; label sizes missing from the file come from the defaults. */
export function cleanConfig(input: unknown): PrintersConfig {
  const formats = (input as { formats?: unknown })?.formats;
  if (!formats || typeof formats !== 'object') throw new Error('printers.json: missing "formats" object');
  const out: Record<string, FormatConfig> = {};
  for (const [key, fallback] of Object.entries(DEFAULT_CONFIG.formats)) {
    out[key] = cleanFormat(key, (formats as Record<string, unknown>)[key], fallback);
  }
  for (const [key, value] of Object.entries(formats as Record<string, unknown>)) {
    if (!(key in out)) out[key] = cleanFormat(key, value);
  }
  return { formats: out };
}

function readConfig(filePath: string): PrintersConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return cleanConfig(JSON.parse(raw));
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
  // Watch the folder, not the file: saves replace the file (atomic rename), which ends a file watch.
  let reloadTimer: NodeJS.Timeout | null = null;
  const fileName = path.basename(configPath);
  watcher = fs.watch(path.dirname(configPath), { persistent: false }, (_event, changed) => {
    if (changed && changed.toString() !== fileName) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, 150);
  });
  const reload = () => {
    try {
      const next = readConfig(configPath!);
      currentConfig = next;
      listeners.forEach((l) => l(next));
      console.log('printers.json reloaded');
    } catch (e) {
      console.error('Failed to reload printers.json (keeping the previous settings):', e);
    }
  };

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

/** Validate, then write atomically (temp file + rename) so a crash never leaves half a file. */
export function saveConfig(config: PrintersConfig): PrintersConfig {
  if (!configPath) {
    throw new Error('Config not initialized');
  }
  const clean = cleanConfig(config);
  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf-8');
  fs.renameSync(tmp, configPath);
  currentConfig = clean;
  listeners.forEach((l) => l(clean));
  return clean;
}
