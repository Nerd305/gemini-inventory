import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { LABEL_PAGE_SIZES, layoutLabels, layoutToSvg, type LabelSpec } from '../shared/labelRender';
import type { LabelFormat } from '../shared/types';

/** True-to-print preview: the same layout the PDF and the print server use, drawn as SVG. */
export function LabelPreview({ label, format, maxWidthPx = 300 }: { label: LabelSpec; format: LabelFormat; maxWidthPx?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const page = LABEL_PAGE_SIZES[format];

  useEffect(() => {
    let cancelled = false;
    setError(null);
    layoutLabels([label], format)
      .then(([layout]) => {
        if (!cancelled) setSvg(layoutToSvg(layout, { border: true }));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Preview failed');
      });
    return () => {
      cancelled = true;
    };
  }, [label.code, label.title, label.subtitle, format]);

  // Scale the real-inch SVG to fit; keep the aspect ratio of the physical label.
  const scale = Math.min(maxWidthPx / page.widthIn, 260 / page.heightIn, 140);
  const style = { width: `${page.widthIn * scale}px`, height: `${page.heightIn * scale}px` };

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!svg) {
    return (
      <div className="flex items-center justify-center rounded border bg-white text-gray-400" style={style}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  return (
    <div
      className="shadow-sm [&>svg]:h-full [&>svg]:w-full"
      style={style}
      role="img"
      aria-label={`Label preview: ${label.title}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
