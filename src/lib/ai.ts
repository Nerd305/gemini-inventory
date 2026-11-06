import { ApiError, GoogleGenAI } from '@google/genai';
import { auth } from '../firebase';

/**
 * Gemini is reached through a same-origin proxy; the browser never holds the API key.
 *  - production: server.js `/api/ai/gemini` verifies the Firebase ID token, checks the user is on the
 *    whitelist and adds the key from Secret Manager before forwarding to Google.
 *  - `npm run dev`: the Vite dev-server proxy in vite.config.ts adds the key from .env.local.
 * @google/genai builds URLs as `${baseUrl}/${apiVersion}/${path}` (apiVersion defaults to v1beta), so a
 * call goes to `${origin}/api/ai/gemini/v1beta/models/gemini-2.5-flash:generateContent`.
 */
export const GEMINI_PROXY_PATH = '/api/ai/gemini';

/** Built per call (cheap): the Firebase ID token is cached by the SDK and refreshed before it expires. */
async function getClient(): Promise<GoogleGenAI> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to use AI features.');
  const idToken = await user.getIdToken();
  return new GoogleGenAI({
    apiKey: 'proxied', // the browser SDK refuses a missing key; the proxy discards this placeholder
    httpOptions: {
      baseUrl: `${window.location.origin}${GEMINI_PROXY_PATH}`,
      headers: { Authorization: `Bearer ${idToken}` },
      timeout: 90_000,
    },
  });
}

/** A proxy refusal with its HTTP status, so callers (the camera HUD) can stop retrying when it is permanent. */
export class AiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AiRequestError';
    this.status = status;
  }
}

/** Turn proxy and SDK failures into one-line messages the counting screens can show as they are. */
function aiError(error: unknown): Error {
  if (error instanceof ApiError) {
    let detail = '';
    try {
      detail = String(JSON.parse(error.message)?.error?.message ?? '');
    } catch {
      /* the body was not JSON */
    }
    if (detail.trimStart().startsWith('<')) detail = ''; // an HTML error page is not worth showing
    const fail = (message: string) => new AiRequestError(message, error.status);
    switch (error.status) {
      case 401: return fail(detail || 'Your sign-in has expired. Sign out, sign in again, then retry.');
      case 403: return fail(detail || 'Your account is not allowed to use AI features.');
      case 404: return fail(detail || 'AI is not available here. Locally, put GEMINI_API_KEY in .env.local and restart npm run dev.');
      case 409: return fail(detail || 'VialTrack was updated. Close and reopen the app, then try again.');
      case 429: return fail(detail || 'Too many AI requests. Wait a minute and try again.');
      case 503: return fail(detail || 'AI is not configured on the server.');
      default: return fail(`AI request failed (HTTP ${error.status}).${detail ? ' ' + detail : ''}`);
    }
  }
  return error instanceof Error ? error : new Error('AI request failed.');
}

/** `models.generateContent` through the proxy, with readable errors. */
async function generate(params: Parameters<GoogleGenAI['models']['generateContent']>[0]) {
  try {
    return await (await getClient()).models.generateContent(params);
  } catch (error) {
    throw aiError(error);
  }
}

export async function analyzeProductImage(base64Image: string) {
  try {
    const response = await generate({
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

  const response = await generate({
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

    const response = await generate({
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

/**
 * Transcribe a compounding label on its own (no counting). Used when registering a tray
 * in a bin, where the photo is usually a close-up of the white label strip.
 */
export async function readCompoundingLabel(base64Image: string): Promise<TrayLabelExtraction | null> {
  if (!base64Image || !base64Image.includes('base64,')) {
    throw new Error('Invalid image format. Please upload a valid image.');
  }
  const prompt =
    'This photo shows a pharmacy compounding label (a printed white strip) on or near a tray of medication vials. ' +
    'Transcribe the label fields exactly as printed. Typical fields: product name (may include strength like "5MG/ML (5ML)"), ' +
    '"Lot #", "Date Compounded", "BUD" (beyond-use date), "Quantity made". Handwritten sticky notes are not the label; ignore them. ' +
    'Return ONLY valid JSON of the shape ' +
    '{"product": string|null, "strength": string|null, "lotNumber": string|null, "dateCompounded": string|null, "bud": string|null, "quantityMade": string|null}. ' +
    'Use null for anything not visible.';
  const response = await generate({
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
    config: { responseMimeType: 'application/json' },
  });
  if (!response.text) return null;
  const l = JSON.parse(response.text);
  if (!l || typeof l !== 'object') return null;
  const candidate: TrayLabelExtraction = {
    product: str(l.product),
    strength: str(l.strength),
    lotNumber: str(l.lotNumber ?? l.lot),
    dateCompounded: str(l.dateCompounded),
    bud: str(l.bud ?? l.beyondUseDate),
    quantityMade: str(l.quantityMade),
  };
  return Object.values(candidate).some((v) => v !== null) ? candidate : null;
}
