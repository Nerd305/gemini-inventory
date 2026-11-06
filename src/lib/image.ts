/**
 * Photo helpers for the AI features.
 *
 * A phone camera photo is 3-6 MB. Sent as base64 it is slow on cellular and far larger than Firestore's
 * 1 MiB document limit, so every photo is shrunk to a JPEG before it goes to Gemini or into learningData.
 */
export const AI_PHOTO_MAX_EDGE = 1600; // long edge sent to Gemini: plenty to count 25 pockets and read a label
export const LEARNING_PHOTO_MAX_EDGE = 800; // smaller copy kept as a training sample

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

/**
 * Shrink a photo (a File/Blob, or a data URL) so its longest side is at most `maxEdge`, and return a
 * `data:image/jpeg;base64,…` URL. Browsers apply the photo's EXIF rotation when drawing, so portrait
 * shots stay upright. If anything fails the original is returned unchanged.
 */
export async function downscaleImage(
  source: Blob | string,
  { maxEdge = AI_PHOTO_MAX_EDGE, quality = 0.8 }: { maxEdge?: number; quality?: number } = {},
): Promise<string> {
  let objectUrl: string | null = null;
  try {
    const src = typeof source === 'string' ? source : (objectUrl = URL.createObjectURL(source));
    const img = await loadImage(src);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longEdge) throw new Error('Empty image');
    const scale = Math.min(1, maxEdge / longEdge);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.fillStyle = '#ffffff'; // JPEG has no transparency
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch (error) {
    console.warn('downscaleImage failed; using the original photo', error);
    return typeof source === 'string' ? source : fileToDataUrl(source);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
