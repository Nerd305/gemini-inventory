/**
 * One label engine for every printer path: exact-size PDFs (AirPrint from a phone or Mac, the
 * desktop print server's `lp`) and SVG (previews, the browser Print Station). A 2.5" × 1.5" label
 * is a 2.5" × 1.5" page; QR codes and barcodes are drawn as vector rectangles so thermal and
 * inkjet label printers render them crisp at any DPI.
 *
 * Used by the web app (src/) and the desktop print server renderer (desktop/renderer via @shared),
 * so it may only import packages both apps install: jspdf, qrcode, jsbarcode.
 */
import type { LabelFormat, StickyRegion } from './types';

export interface LabelSpec {
  code: string;
  title: string;
  subtitle?: string;
}

export interface PageSizeIn {
  widthIn: number;
  heightIn: number;
}

/** Physical page per format. Must match `formats` in desktop/config/printers.json. */
export const LABEL_PAGE_SIZES: Record<LabelFormat, PageSizeIn> = {
  '4x3': { widthIn: 4, heightIn: 3 },
  '1.5x1.5': { widthIn: 1.5, heightIn: 1.5 },
  '2.5x0.7': { widthIn: 2.5, heightIn: 0.7 },
  '2.5x1.5': { widthIn: 2.5, heightIn: 1.5 },
  'canon-integrated': { widthIn: 8.5, heightIn: 11 },
};

export const DEFAULT_STICKY_REGION: StickyRegion = { xIn: 1.25, yIn: 6.5, widthIn: 6, heightIn: 4 };

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'text'; x: number; y: number; text: string; sizePt: number; bold?: boolean; mono?: boolean; align: 'left' | 'center' };

export interface LabelLayout extends PageSizeIn {
  shapes: Shape[];
}

export interface LayoutOptions {
  /** Override the page (e.g. from the print server's printers.json). */
  pageSize?: PageSizeIn;
  /** canon-integrated: where the adhesive label sits on the Letter sheet. */
  stickyRegion?: StickyRegion;
}

interface Engine {
  /** Text width in inches. */
  measure: (text: string, sizePt: number, font: { bold?: boolean; mono?: boolean }) => number;
  /** QR modules, row-major, true = dark. */
  qr: (text: string) => boolean[][];
  /** CODE128 bars as "1"/"0" modules, or null if the text can't be encoded. */
  barcode: (text: string) => string | null;
}

const LINE = 1.18; // line height as a multiple of the font size
const ptIn = (pt: number) => pt / 72;
/** Smallest barcode bar we trust a phone camera with (10 mil). Below that the slim label uses a QR. */
const MIN_BAR_IN = 0.01;

/** Greedy word wrap; words wider than the line are broken by character. */
function wrap(e: Engine, text: string, maxW: number, sizePt: number, bold: boolean): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  const fits = (s: string) => e.measure(s, sizePt, { bold }) <= maxW;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (fits(word)) {
      line = word;
      continue;
    }
    let chunk = '';
    for (const ch of word) {
      if (fits(chunk + ch)) chunk += ch;
      else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest font size (maxPt → minPt) at which the text fits in maxLines; truncates with … at minPt. */
function fitText(e: Engine, text: string, maxW: number, maxLines: number, maxPt: number, minPt: number, bold = false) {
  const clean = text.trim();
  if (!clean) return { lines: [] as string[], sizePt: minPt };
  for (let size = maxPt; size >= minPt; size -= 0.5) {
    const lines = wrap(e, clean, maxW, size, bold);
    if (lines.length <= maxLines) return { lines, sizePt: size };
  }
  const lines = wrap(e, clean, maxW, minPt, bold).slice(0, maxLines);
  let last = lines[lines.length - 1] ?? '';
  while (last.length > 1 && e.measure(`${last}…`, minPt, { bold }) > maxW) last = last.slice(0, -1);
  lines[lines.length - 1] = `${last}…`;
  return { lines, sizePt: minPt };
}

const blockHeight = (b: { lines: string[]; sizePt: number }) => b.lines.length * ptIn(b.sizePt) * LINE;

function pushText(shapes: Shape[], b: { lines: string[]; sizePt: number }, x: number, top: number, align: 'left' | 'center', font: { bold?: boolean; mono?: boolean } = {}) {
  let y = top;
  for (const text of b.lines) {
    y += ptIn(b.sizePt);
    shapes.push({ kind: 'text', x, y, text, sizePt: b.sizePt, align, ...font });
    y += ptIn(b.sizePt) * (LINE - 1);
  }
  return y;
}

function pushQr(shapes: Shape[], modules: boolean[][], x: number, y: number, size: number) {
  const n = modules.length;
  const m = size / n;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!modules[r][c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && modules[r][c]) c++;
      // Slight overlap so anti-aliased renderers don't show hairlines between modules.
      shapes.push({ kind: 'rect', x: x + start * m, y: y + r * m, w: (c - start) * m + 0.0005, h: m + 0.0005 });
    }
  }
}

function pushBars(shapes: Shape[], bars: string, x: number, y: number, w: number, h: number) {
  const m = w / bars.length;
  let i = 0;
  while (i < bars.length) {
    if (bars[i] !== '1') {
      i++;
      continue;
    }
    const start = i;
    while (i < bars.length && bars[i] === '1') i++;
    shapes.push({ kind: 'rect', x: x + start * m, y, w: (i - start) * m, h });
  }
}

/** Title / subtitle / QR / code stacked and centred: 4x3, 1.5x1.5 and the Canon sticky region. */
function stacked(
  e: Engine,
  spec: LabelSpec,
  box: { x: number; y: number; w: number; h: number },
  t: { title: [number, number, number]; subtitle?: [number, number, number]; code?: number; qrMax: number },
): Shape[] {
  const shapes: Shape[] = [];
  const gap = Math.min(0.06, box.h * 0.04);
  const title = fitText(e, spec.title, box.w, t.title[0], t.title[1], t.title[2], true);
  const subtitle = t.subtitle && spec.subtitle ? fitText(e, spec.subtitle, box.w, t.subtitle[0], t.subtitle[1], t.subtitle[2]) : null;
  const code = t.code ? fitText(e, spec.code, box.w, 1, t.code, Math.max(4, t.code - 3)) : null;
  const textH = blockHeight(title) + (subtitle ? blockHeight(subtitle) + gap * 0.5 : 0) + (code ? blockHeight(code) + gap : 0);
  const qr = Math.max(0.3, Math.min(t.qrMax, box.w, box.h - textH - gap));
  const total = textH + gap + qr;
  let y = box.y + Math.max(0, (box.h - total) / 2);
  const cx = box.x + box.w / 2;
  y = pushText(shapes, title, cx, y, 'center', { bold: true });
  if (subtitle) y = pushText(shapes, subtitle, cx, y + gap * 0.5, 'center');
  y += gap;
  pushQr(shapes, e.qr(spec.code), cx - qr / 2, y, qr);
  y += qr;
  if (code) pushText(shapes, code, cx, y + gap, 'center', { mono: true });
  return shapes;
}

/** QR on the left, text on the right: the 2.5x1.5 bin / tray / shelf label and the slim fallback. */
function sideBySide(
  e: Engine,
  spec: LabelSpec,
  page: PageSizeIn,
  t: { margin: number; qrMax: number; title: [number, number, number]; subtitle: [number, number, number] },
): Shape[] {
  const shapes: Shape[] = [];
  const m = t.margin;
  const qr = Math.min(t.qrMax, page.heightIn - 2 * m);
  const gap = Math.max(0.06, m);
  pushQr(shapes, e.qr(spec.code), m, (page.heightIn - qr) / 2, qr);
  const tx = m + qr + gap;
  const tw = page.widthIn - tx - m;
  const title = fitText(e, spec.title, tw, t.title[0], t.title[1], t.title[2], true);
  const subtitle = spec.subtitle ? fitText(e, spec.subtitle, tw, t.subtitle[0], t.subtitle[1], t.subtitle[2]) : null;
  const between = subtitle ? ptIn(subtitle.sizePt) * 0.6 : 0;
  const textH = blockHeight(title) + (subtitle ? between + blockHeight(subtitle) : 0);
  let y = Math.max(m, (page.heightIn - textH) / 2);
  y = pushText(shapes, title, tx, y, 'left', { bold: true });
  if (subtitle) pushText(shapes, subtitle, tx, y + between, 'left');
  return shapes;
}

export function layoutLabel(e: Engine, spec: LabelSpec, format: LabelFormat, opts: LayoutOptions = {}): LabelLayout {
  const page = opts.pageSize ?? LABEL_PAGE_SIZES[format];
  const W = page.widthIn;
  const H = page.heightIn;
  const m = Math.min(0.08, Math.min(W, H) * 0.06);
  let shapes: Shape[];
  switch (format) {
    case '2.5x1.5':
      shapes = sideBySide(e, spec, page, { margin: m, qrMax: 1.22, title: [3, 11, 7], subtitle: [2, 7.5, 5.5] });
      break;
    case '2.5x0.7': {
      const bars = e.barcode(spec.code);
      const barW = W - 2 * m;
      if (bars && barW / bars.length >= MIN_BAR_IN) {
        shapes = [];
        const title = fitText(e, spec.title, barW, 1, 7, 5, true);
        const barH = H - 2 * m - blockHeight(title) - 0.03;
        pushBars(shapes, bars, m, m, barW, barH);
        pushText(shapes, title, W / 2, m + barH + 0.03, 'center', { bold: true });
      } else {
        // The code is too long for bars a phone camera can read at this width: small QR instead.
        shapes = sideBySide(e, spec, page, { margin: 0.05, qrMax: 0.6, title: [2, 9, 6], subtitle: [1, 6.5, 5] });
      }
      break;
    }
    case '1.5x1.5':
      shapes = stacked(e, spec, { x: m, y: m, w: W - 2 * m, h: H - 2 * m }, { title: [2, 9, 6], qrMax: 1.15 });
      break;
    case '4x3':
      shapes = stacked(e, spec, { x: 0.15, y: 0.12, w: W - 0.3, h: H - 0.24 }, { title: [2, 20, 12], subtitle: [2, 13, 8], code: 8, qrMax: 1.9 });
      break;
    case 'canon-integrated': {
      const r = opts.stickyRegion ?? DEFAULT_STICKY_REGION;
      shapes = stacked(e, spec, { x: r.xIn + 0.15, y: r.yIn + 0.15, w: r.widthIn - 0.3, h: r.heightIn - 0.3 }, { title: [2, 28, 14], subtitle: [2, 18, 10], code: 10, qrMax: 2.6 });
      break;
    }
    default:
      shapes = stacked(e, spec, { x: m, y: m, w: W - 2 * m, h: H - 2 * m }, { title: [2, 14, 7], subtitle: [2, 10, 6], qrMax: Math.min(W, H) * 0.6 });
  }
  return { widthIn: W, heightIn: H, shapes };
}

// ---------------------------------------------------------------------------
// Engine loading (dynamic imports keep ~400 KB out of the main bundle)
// ---------------------------------------------------------------------------

type JsPdfCtor = typeof import('jspdf').jsPDF;
let enginePromise: Promise<{ engine: Engine; JsPDF: JsPdfCtor }> | null = null;

async function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [{ jsPDF }, qrcodeMod, barcodeMod] = await Promise.all([import('jspdf'), import('qrcode'), import('jsbarcode')]);
      const QRCode = (qrcodeMod as unknown as { default?: typeof import('qrcode') }).default ?? qrcodeMod;
      const JsBarcode = ((barcodeMod as unknown as { default?: unknown }).default ?? barcodeMod) as (target: object, text: string, opts: object) => void;
      const meter = new jsPDF({ unit: 'in', format: 'letter' });
      const engine: Engine = {
        measure: (text, sizePt, font) => {
          meter.setFont(font.mono ? 'courier' : 'helvetica', font.bold ? 'bold' : 'normal');
          return (meter.getStringUnitWidth(text) * sizePt) / 72;
        },
        qr: (text) => {
          const q = QRCode.create(text || ' ', { errorCorrectionLevel: 'M' });
          const n = q.modules.size;
          return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => Boolean(q.modules.get(r, c))));
        },
        barcode: (text) => {
          try {
            const target: { encodings?: { data: string }[] } = {};
            JsBarcode(target, text, { format: 'CODE128', displayValue: false });
            return target.encodings?.map((enc) => enc.data).join('') || null;
          } catch {
            return null;
          }
        },
      };
      return { engine, JsPDF: jsPDF };
    })();
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

export async function layoutLabels(labels: LabelSpec[], format: LabelFormat, opts: LayoutOptions = {}): Promise<LabelLayout[]> {
  const { engine } = await loadEngine();
  return labels.map((spec) => layoutLabel(engine, spec, format, opts));
}

/** One label per page, each page exactly the label size. */
export async function renderLabelsPdf(labels: LabelSpec[], format: LabelFormat, opts: LayoutOptions = {}): Promise<ArrayBuffer> {
  if (labels.length === 0) throw new Error('No labels to print.');
  const { engine, JsPDF } = await loadEngine();
  const page = opts.pageSize ?? LABEL_PAGE_SIZES[format];
  const orientation = page.widthIn > page.heightIn ? 'landscape' : 'portrait';
  const doc = new JsPDF({ unit: 'in', format: [page.widthIn, page.heightIn], orientation, compress: true });
  doc.setProperties({ title: labels.length === 1 ? labels[0].title : `${labels.length} labels`, creator: 'VialTrack' });
  labels.forEach((spec, i) => {
    if (i > 0) doc.addPage([page.widthIn, page.heightIn], orientation);
    const layout = layoutLabel(engine, spec, format, opts);
    doc.setFillColor(0, 0, 0);
    doc.setTextColor(0, 0, 0);
    for (const s of layout.shapes) {
      if (s.kind === 'rect') {
        doc.rect(s.x, s.y, s.w, s.h, 'F');
      } else {
        doc.setFont(s.mono ? 'courier' : 'helvetica', s.bold ? 'bold' : 'normal');
        doc.setFontSize(s.sizePt);
        doc.text(s.text, s.x, s.y, { align: s.align, baseline: 'alphabetic' });
      }
    }
  });
  return doc.output('arraybuffer');
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);

/** SVG for previews and browser printing; sized in real inches. */
export function layoutToSvg(layout: LabelLayout, opts: { border?: boolean } = {}): string {
  const parts = layout.shapes.map((s) => {
    if (s.kind === 'rect') return `<rect x="${s.x.toFixed(4)}" y="${s.y.toFixed(4)}" width="${s.w.toFixed(4)}" height="${s.h.toFixed(4)}"/>`;
    const family = s.mono ? 'Courier, monospace' : 'Helvetica, Arial, sans-serif';
    return `<text x="${s.x.toFixed(4)}" y="${s.y.toFixed(4)}" font-size="${(s.sizePt / 72).toFixed(4)}" font-family="${family}" font-weight="${s.bold ? 700 : 400}" text-anchor="${s.align === 'center' ? 'middle' : 'start'}">${escapeXml(s.text)}</text>`;
  });
  const border = opts.border
    ? `<rect x="0.003" y="0.003" width="${(layout.widthIn - 0.006).toFixed(4)}" height="${(layout.heightIn - 0.006).toFixed(4)}" fill="none" stroke="#cbd5e1" stroke-width="0.006"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.widthIn} ${layout.heightIn}" width="${layout.widthIn}in" height="${layout.heightIn}in">` +
    `<rect width="100%" height="100%" fill="#fff"/>${border}<g fill="#000">${parts.join('')}</g></svg>`
  );
}
