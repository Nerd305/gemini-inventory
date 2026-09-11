import { GoogleGenAI } from '@google/genai';

/**
 * The Gemini client is created lazily: constructing it at module load with a missing key
 * throws inside the browser and takes the whole app (including login) down with it.
 * Without a key, only the AI buttons fail — manual counting keeps working.
 */
let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured, so AI features are unavailable. Count manually or add the key in Settings/AI Studio secrets.');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export async function analyzeProductImage(base64Image: string) {
  try {
    const response = await getClient().models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Analyze this image of a medication or medical product. Return a JSON object with the following fields: "name" (the name of the product), "category" (a suggested category like "Pain Relief", "Antibiotics", "Supplies", etc.), and "description" (a brief description of what it is). Return ONLY valid JSON.' },
            {
              inlineData: {
                data: base64Image.split(',')[1],
                mimeType: base64Image.split(';')[0].split(':')[1],
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
      }
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    return null;
  } catch (error) {
    console.error("Error analyzing image:", error);
    throw error;
  }
}

export interface VialDetection {
  x: number;
  y: number;
  w: number;
  h: number;
  capColor: string;
}

export interface FrameAnalysis {
  detections: VialDetection[];
}

export async function analyzeFrame(base64Image: string): Promise<FrameAnalysis> {
  if (!base64Image || !base64Image.includes('base64,')) {
    throw new Error('Invalid image format.');
  }

  const response = await getClient().models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              'Detect every medication vial visible in this image. ' +
              'Return ONLY valid JSON of shape ' +
              '{"detections":[{"x":number,"y":number,"w":number,"h":number,"capColor":"#rrggbb"}]}. ' +
              'x, y, w, h are percentages (0-100) of image width/height where (x,y) is the top-left ' +
              'corner of the bounding box. capColor is the dominant hex color of the vial cap. ' +
              'If no vials are visible, return {"detections":[]}.',
          },
          {
            inlineData: {
              data: base64Image.split(',')[1],
              mimeType: base64Image.split(';')[0].split(':')[1],
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  if (!response.text) return { detections: [] };

  const parsed = JSON.parse(response.text);
  const raw = Array.isArray(parsed?.detections) ? parsed.detections : [];
  const detections: VialDetection[] = raw
    .map((d: any) => ({
      x: Number(d?.x),
      y: Number(d?.y),
      w: Number(d?.w),
      h: Number(d?.h),
      capColor: typeof d?.capColor === 'string' ? d.capColor : '#ffffff',
    }))
    .filter(
      (d: VialDetection) =>
        Number.isFinite(d.x) &&
        Number.isFinite(d.y) &&
        Number.isFinite(d.w) &&
        Number.isFinite(d.h) &&
        d.w > 0 &&
        d.h > 0,
    );

  return { detections };
}

export interface TrayLabelExtraction {
  product: string | null;
  strength: string | null;
  lotNumber: string | null;
  dateCompounded: string | null;
  bud: string | null;
  quantityMade: string | null;
}

export interface TrayCountResult {
  vialCount: number;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
  /** Fields transcribed from the compounding label when one is visible in the photo. */
  label: TrayLabelExtraction | null;
}

export interface TrayCountOptions {
  /** Pocket capacity of the tray (default 25). */
  capacity?: number;
  rows?: number;
  cols?: number;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'n/a' ? t : null;
}

/**
 * Count the vials in a photo of one tray and, when a compounding label is visible,
 * transcribe its lot / BUD / date fields. The tray geometry is passed in so the model
 * can reason about occupied vs. empty pockets instead of guessing.
 */
export async function countVialsInTray(
  base64Image: string,
  options: TrayCountOptions = {},
): Promise<TrayCountResult> {
  try {
    if (!base64Image || !base64Image.includes('base64,')) {
      throw new Error('Invalid image format. Please upload a valid image.');
    }
    const rows = options.rows ?? 5;
    const cols = options.cols ?? 5;
    const capacity = options.capacity ?? rows * cols;

    const prompt =
      'You are counting medication vials for a compounding pharmacy inventory. ' +
      `The photo shows ONE clear molded plastic tray with a grid of ${rows} x ${cols} pockets (${capacity} pockets total). ` +
      'Each pocket holds at most one vial. Vials are small glass bottles with a colored flip-off cap, photographed from above; ' +
      'an occupied pocket shows a colored cap, an empty pocket shows the clear plastic bottom. ' +
      `Count only vials that are actually present. The count can never exceed ${capacity}. ` +
      'Do not count the sticky note or the label as vials. ' +
      'If a printed compounding label is visible (it usually lists the product name and strength, "Lot #", "Date Compounded", "BUD", and "Quantity made"), ' +
      'transcribe those fields exactly as printed; otherwise set "label" to null. ' +
      'Return ONLY valid JSON of the shape ' +
      '{"vialCount": number, "confidence": "high"|"medium"|"low", "notes": string, ' +
      '"label": {"product": string|null, "strength": string|null, "lotNumber": string|null, "dateCompounded": string|null, "bud": string|null, "quantityMade": string|null} | null}.';

    const response = await getClient().models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Image.split(',')[1],
                mimeType: base64Image.split(';')[0].split(':')[1],
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    if (!response.text) throw new Error('No response from AI model');
    const parsed = JSON.parse(response.text);
    const vialCount = Number(parsed?.vialCount);
    if (!Number.isFinite(vialCount) || vialCount < 0) {
      throw new Error('Invalid response from AI model');
    }
    const confidenceRaw = typeof parsed?.confidence === 'string' ? parsed.confidence.toLowerCase() : 'medium';
    const confidence: TrayCountResult['confidence'] =
      confidenceRaw === 'high' || confidenceRaw === 'low' ? confidenceRaw : 'medium';

    let label: TrayLabelExtraction | null = null;
    if (parsed?.label && typeof parsed.label === 'object') {
      const l = parsed.label;
      const candidate: TrayLabelExtraction = {
        product: str(l.product),
        strength: str(l.strength),
        lotNumber: str(l.lotNumber ?? l.lot),
        dateCompounded: str(l.dateCompounded),
        bud: str(l.bud ?? l.beyondUseDate),
        quantityMade: str(l.quantityMade),
      };
      if (Object.values(candidate).some((v) => v !== null)) label = candidate;
    }

    return {
      vialCount: Math.min(capacity, Math.round(vialCount)),
      confidence,
      notes: typeof parsed?.notes === 'string' ? parsed.notes : undefined,
      label,
    };
  } catch (error) {
    console.error('Error counting vials:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to analyze vial tray. Please try again.');
  }
}
