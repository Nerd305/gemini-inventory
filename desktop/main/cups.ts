/**
 * CUPS helpers for the print server: list printers, read their paper sizes, check one before
 * printing, and submit a PDF with `lp`. The parsers are pure functions so they can be tested
 * against captured `lpstat` / `lpoptions` output.
 */
import { execFile, spawn } from 'node:child_process';

export type PrinterState = 'idle' | 'printing' | 'disabled' | 'unknown';

export interface CupsPrinter {
  /** CUPS queue name, as `lp -d` wants it. */
  device: string;
  state: PrinterState;
  /** False when the queue is paused / rejecting jobs. */
  enabled: boolean;
  description: string;
  /** Free text after the state (e.g. the reason a printer is paused). */
  detail: string;
  isDefault: boolean;
}

/**
 * Parse `lpstat -l -p` (long form adds "Description:" lines) plus the default from `lpstat -d`.
 *   printer EPSON_C6000 is idle.  enabled since Tue Nov  4 10:00:00 2026
 *   printer Zebra_ZD410 disabled since Tue Nov  4 10:00:00 2026 -
 *   	Paused
 *   printer Canon now printing Canon-12.  enabled since …
 *   	Description: Canon TR8620
 */
export function parseLpstatPrinters(lpstat: string, defaultOut = ''): CupsPrinter[] {
  const def = defaultOut.match(/system default destination:\s*(\S+)/)?.[1] ?? '';
  const printers: CupsPrinter[] = [];
  let current: CupsPrinter | null = null;
  for (const raw of lpstat.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const head = line.match(/^printer (\S+) (.*)$/);
    if (head) {
      const rest = head[2];
      const state: PrinterState = /disabled since/.test(rest)
        ? 'disabled'
        : /now printing/.test(rest)
        ? 'printing'
        : /is idle/.test(rest)
        ? 'idle'
        : 'unknown';
      current = {
        device: head[1],
        state,
        enabled: state !== 'disabled' && !/\bdisabled\b/.test(rest),
        description: '',
        detail: '',
        isDefault: head[1] === def,
      };
      printers.push(current);
      continue;
    }
    if (!current) continue;
    const desc = line.match(/^\s+Description:\s*(.*)$/);
    if (desc) {
      current.description = desc[1].trim();
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && !/^(Alerts|Location|Connection|Interface|On fault|After fault|Users allowed|Forms allowed|Banner required|Charset sets|Default pitch|Default page size|Default port settings|Form mounted|Content types|Printer types|Rejecting Jobs|Accepting Jobs|Kerberos|Users denied|Description)/.test(trimmed) && !trimmed.includes(':') && !current.detail) {
      current.detail = trimmed; // e.g. "Paused" under a disabled printer
    }
  }
  return printers;
}

export interface MediaSize {
  /** The value for `-o media=` / `-o PageSize=`. */
  key: string;
  /** Option name the driver uses: PageSize (PPD drivers) or media (IPP Everywhere / AirPrint). */
  option: string;
  widthIn?: number;
  heightIn?: number;
  isDefault: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Size in inches from a media key: w180h108 (points), Custom.2.5x1.5in, oe_..._2.5x1.5in, om_..._62x100mm. */
export function mediaKeyToInches(key: string): { widthIn: number; heightIn: number } | null {
  const pts = key.match(/^w(\d+(?:\.\d+)?)h(\d+(?:\.\d+)?)/);
  if (pts) return { widthIn: round2(Number(pts[1]) / 72), heightIn: round2(Number(pts[2]) / 72) };
  const inch = key.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)in\b/);
  if (inch) return { widthIn: Number(inch[1]), heightIn: Number(inch[2]) };
  const mm = key.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm\b/);
  if (mm) return { widthIn: round2(Number(mm[1]) / 25.4), heightIn: round2(Number(mm[2]) / 25.4) };
  const named: Record<string, [number, number]> = { Letter: [8.5, 11], Legal: [8.5, 14], A4: [8.27, 11.69], A6: [4.13, 5.83] };
  if (named[key]) return { widthIn: named[key][0], heightIn: named[key][1] };
  return null;
}

/** Parse `lpoptions -p NAME -l`, e.g. "PageSize/Media Size: *w180h108 w288h216 Custom.WIDTHxHEIGHT". */
export function parseMediaSizes(lpoptions: string): MediaSize[] {
  const out: MediaSize[] = [];
  for (const line of lpoptions.split('\n')) {
    const m = line.match(/^(PageSize|media)\/[^:]*:\s*(.*)$/);
    if (!m) continue;
    for (const token of m[2].trim().split(/\s+/)) {
      if (!token) continue;
      const isDefault = token.startsWith('*');
      const key = isDefault ? token.slice(1) : token;
      if (key.startsWith('Custom.WIDTH')) continue;
      const size = mediaKeyToInches(key);
      out.push({ key, option: m[1], isDefault, ...(size ?? {}) });
    }
    if (out.length > 0) break; // prefer the first option the driver lists
  }
  return out;
}

/** Media keys whose size matches the label (either orientation, ±0.03"). */
export function matchingMedia(sizes: MediaSize[], widthIn: number, heightIn: number): MediaSize[] {
  const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= 0.03;
  return sizes.filter((s) => (near(s.widthIn, widthIn) && near(s.heightIn, heightIn)) || (near(s.widthIn, heightIn) && near(s.heightIn, widthIn)));
}

function run(cmd: string, args: string[], timeoutMs = 10_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? (error ? String(error.message) : '') });
    });
  });
}

export async function listPrinters(): Promise<CupsPrinter[]> {
  const [p, d] = await Promise.all([run('lpstat', ['-l', '-p']), run('lpstat', ['-d'])]);
  return parseLpstatPrinters(p.stdout, d.stdout);
}

export async function printerMediaSizes(device: string): Promise<MediaSize[]> {
  const r = await run('lpoptions', ['-p', device, '-l']);
  return parseMediaSizes(r.stdout);
}

/** Why a printer can't take a job right now, in words for the screen; null when it can. */
export async function printerProblem(device: string): Promise<string | null> {
  const r = await run('lpstat', ['-l', '-p', device]);
  if (r.code !== 0 || !r.stdout.trim()) {
    return `Printer "${device}" isn't set up on this Mac (or its name changed). Add it in System Settings → Printers & Scanners, then pick it again in the print server's Settings → Label sizes.`;
  }
  const [printer] = parseLpstatPrinters(r.stdout);
  if (printer && (printer.state === 'disabled' || !printer.enabled)) {
    return `Printer "${device}" is paused${printer.detail ? ` (${printer.detail})` : ''}. Resume it in System Settings → Printers & Scanners → Open Print Queue, or run: cupsenable ${device}`;
  }
  return null;
}

/** Submit a PDF with lp. Resolves with the CUPS request id. */
export function submitPdf(device: string, pdfPath: string, lpOptions: string[], title: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-d', device, '-t', title.slice(0, 120), ...lpOptions, pdfPath];
    const child = spawn('lp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`lp did not answer within ${Math.round(timeoutMs / 1000)} s (CUPS may be stuck: restart the Mac's printing system or the printer).`));
    }, timeoutMs);
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.match(/request id is (\S+)/)?.[1] ?? '');
      else reject(new Error(`lp failed (exit ${code}): ${stderr.trim() || stdout.trim() || 'no output'}`));
    });
  });
}
