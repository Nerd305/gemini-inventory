import { useEffect, useRef, useState } from 'react';
import { analyzeVideoFrame } from '../../lib/frameAnalyzer';
import type { CapColorMap } from '../../lib/config';
import type { VialDetection } from '../../lib/ai';

interface CameraHUDProps {
  videoSelector?: string;
  capColorMap?: CapColorMap;
  live?: boolean;
  intervalMs?: number;
  detections?: VialDetection[];
}

const STATIC_STROKE = 'rgba(255, 255, 255, 0.55)';
const BRACKET_LEN_PCT = 0.08;

function drawStaticHud(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = STATIC_STROKE;

  const cx = width / 2;
  const cy = height / 2;
  const arm = Math.min(width, height) * 0.04;

  ctx.beginPath();
  ctx.moveTo(cx - arm, cy);
  ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm);
  ctx.lineTo(cx, cy + arm);
  ctx.stroke();

  const inset = Math.min(width, height) * 0.08;
  const len = Math.min(width, height) * BRACKET_LEN_PCT;
  ctx.lineWidth = 2;

  // top-left
  ctx.beginPath();
  ctx.moveTo(inset, inset + len);
  ctx.lineTo(inset, inset);
  ctx.lineTo(inset + len, inset);
  // top-right
  ctx.moveTo(width - inset - len, inset);
  ctx.lineTo(width - inset, inset);
  ctx.lineTo(width - inset, inset + len);
  // bottom-left
  ctx.moveTo(inset, height - inset - len);
  ctx.lineTo(inset, height - inset);
  ctx.lineTo(inset + len, height - inset);
  // bottom-right
  ctx.moveTo(width - inset - len, height - inset);
  ctx.lineTo(width - inset, height - inset);
  ctx.lineTo(width - inset, height - inset - len);
  ctx.stroke();

  ctx.restore();
}

function colorKeyFor(hex: string): string {
  return hex.trim().toLowerCase();
}

function lookupProductLabel(capHex: string, capColorMap: CapColorMap): string | null {
  if (!capColorMap) return null;
  const key = colorKeyFor(capHex);
  for (const [color, product] of Object.entries(capColorMap) as [string, string][]) {
    if (colorKeyFor(color) === key) return product;
  }
  return null;
}

function drawDetections(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  detections: VialDetection[],
  capColorMap: CapColorMap,
) {
  ctx.save();
  ctx.font = '12px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'top';

  for (const d of detections) {
    const x = (d.x / 100) * width;
    const y = (d.y / 100) * height;
    const w = (d.w / 100) * width;
    const h = (d.h / 100) * height;

    ctx.lineWidth = 2;
    ctx.strokeStyle = d.capColor || '#00ff88';
    ctx.strokeRect(x, y, w, h);

    const label = lookupProductLabel(d.capColor, capColorMap);
    if (label) {
      const padding = 4;
      const textWidth = ctx.measureText(label).width;
      const labelX = x;
      const labelY = Math.max(0, y - 18);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(labelX, labelY, textWidth + padding * 2, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, labelX + padding, labelY + 2);
    }
  }
  ctx.restore();
}

export default function CameraHUD({
  videoSelector = 'video',
  capColorMap = {},
  live = false,
  intervalMs = 2000,
  detections: externalDetections,
}: CameraHUDProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [liveDetections, setLiveDetections] = useState<VialDetection[]>([]);

  const detections = externalDetections ?? liveDetections;

  // Resize canvas to match the container.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Render loop (static + dynamic) on every frame so brackets stay crisp on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const render = () => {
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      drawStaticHud(ctx, cssWidth, cssHeight);
      if (detections.length > 0) {
        drawDetections(ctx, cssWidth, cssHeight, detections, capColorMap);
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [detections, capColorMap]);

  // Live polling loop.
  useEffect(() => {
    if (!live || externalDetections) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      const video = document.querySelector<HTMLVideoElement>(videoSelector);
      if (video && video.readyState >= 2) {
        try {
          const result = await analyzeVideoFrame(video);
          if (!cancelled) setLiveDetections(result.detections);
        } catch (err) {
          console.error('HUD frame analysis failed', err);
        }
      }
      if (!cancelled) {
        timer = window.setTimeout(tick, intervalMs);
      }
    };

    timer = window.setTimeout(tick, intervalMs);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [live, externalDetections, videoSelector, intervalMs]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0"
      aria-hidden
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
