import { renderLabelsPdf, type LabelSpec } from '../shared/labelRender';
import type { LabelFormat } from '../shared/types';

/**
 * "Print here": build an exact-size PDF (one label per page) and open it, so the phone's or
 * computer's own print dialog sends it to any AirPrint / system printer at the label's real size.
 *
 * Call `preparePrintWindow()` synchronously inside the click handler (before any await): iOS
 * Safari only allows opening a tab directly from a tap. If the tab can't be opened (pop-ups
 * blocked, AI Studio preview frame), the PDF downloads instead.
 */
export function preparePrintWindow(): Window | null {
  try {
    const w = window.open('', '_blank');
    if (w) {
      w.document.title = 'Preparing labels…';
      w.document.body.style.font = '16px -apple-system, system-ui, sans-serif';
      w.document.body.style.padding = '24px';
      w.document.body.textContent = 'Preparing labels…';
    }
    return w;
  } catch {
    return null;
  }
}

function fileName(labels: LabelSpec[], format: LabelFormat) {
  const base = labels.length === 1 ? labels[0].title : `${labels.length}-labels`;
  return `${base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'labels'}-${format}.pdf`;
}

export async function openLabelsPdf(
  labels: LabelSpec[],
  format: LabelFormat,
  win: Window | null,
  opts: { download?: boolean } = {},
): Promise<'opened' | 'downloaded'> {
  let bytes: ArrayBuffer;
  try {
    bytes = await renderLabelsPdf(labels, format);
  } catch (err) {
    if (win && !win.closed) win.close();
    throw err;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  if (!opts.download && win && !win.closed) {
    win.location.href = url;
    return 'opened';
  }
  if (win && !win.closed) win.close();
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(labels, format);
  document.body.appendChild(a);
  a.click();
  a.remove();
  return 'downloaded';
}

export const LOCAL_PRINT_HINT =
  'Opens the labels as a PDF at their real size. Print it (⌘P, or Share → Print on iPhone/iPad), pick the label printer, ' +
  'and check the paper size matches the label. Set scale to 100% / "Actual size" if the dialog offers it.';
