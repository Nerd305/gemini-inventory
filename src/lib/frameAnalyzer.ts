import { analyzeFrame, FrameAnalysis, VialDetection } from './ai';

export type { FrameAnalysis, VialDetection };

export function captureVideoFrame(
  video: HTMLVideoElement,
  maxWidth = 720,
): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;

  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

export async function analyzeVideoFrame(
  video: HTMLVideoElement,
): Promise<FrameAnalysis> {
  const dataUrl = captureVideoFrame(video);
  if (!dataUrl) return { detections: [] };
  return analyzeFrame(dataUrl);
}
