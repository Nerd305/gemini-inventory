import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { countVialsInTray } from '../../lib/ai';

export interface AiCountSample {
  imageBase64: string;
  prediction: number;
  confidence?: string;
}

interface AiCountButtonProps {
  label?: string;
  disabled?: boolean;
  onResult: (sample: AiCountSample) => void;
  onError?: (message: string) => void;
}

/**
 * Take a photo of the partial (loose) tray and let Gemini count it.
 * The caller stores the sample so a learning record can be written on accept.
 */
/**
 * iPhone photos are 12MP+; shrink before upload so Gemini answers in ~2s instead of ~10s
 * and the learning sample stays well under Firestore's 1 MB document limit.
 */
async function downscaleToDataUrl(file: File, maxEdge: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.readAsDataURL(file);
    });
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}

export default function AiCountButton({ label = 'AI count loose tray', disabled, onResult, onError }: AiCountButtonProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (file: File) => {
    setLoading(true);
    try {
      const dataUrl = await downscaleToDataUrl(file, 1024, 0.8);
      const result = await countVialsInTray(dataUrl);
      if (result && typeof result.vialCount === 'number') {
        onResult({ imageBase64: dataUrl, prediction: result.vialCount, confidence: result.confidence });
      } else {
        onError?.('AI returned no count');
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'AI count failed');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) run(f);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => fileRef.current?.click()}
        disabled={disabled || loading}
      >
        {loading ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Counting…</>
        ) : (
          <><Camera className="h-4 w-4 mr-2" /> {label}</>
        )}
      </Button>
    </>
  );
}
