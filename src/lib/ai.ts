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

// ---------------------------------------------------------------------------
// Voice commands in /count (src/lib/voiceCommands.ts parses the easy ones locally;
// Gemini gets the sentences it can't, and the audio when the browser can't transcribe)
// ---------------------------------------------------------------------------

export interface VoiceInterpretation {
  /** The words Gemini heard (audio) or was given (text). */
  transcript: string;
  /** Unvalidated command objects; run them through coerceVoiceCommands before use. */
  commands: unknown[];
}

const VOICE_PROMPT =
  'You turn what a pharmacy technician says while counting vials into commands for an inventory app. ' +
  'They work fridge -> shelf -> bin (one product per bin) -> trays (usually 25 vials per tray, counted one tray at a time). ' +
  'Return ONLY JSON: {"transcript": string, "commands": Command[]}. "transcript" is exactly what was said, in plain words. ' +
  'Command is one of: ' +
  '{"kind":"count","value":N} vials in the open tray; ' +
  '{"kind":"adjust","delta":N} add or take away N (negative to take away); ' +
  '{"kind":"full"} the open tray is full; {"kind":"empty"} the open tray is empty; ' +
  '{"kind":"save"} accept the open tray, or finish the bin from the tray grid; ' +
  '{"kind":"next"} save and open the next uncounted tray; {"kind":"cancel"} close without saving; ' +
  '{"kind":"tray","slot":N} open tray number N; {"kind":"loose","value":N} loose vials in the bin (not in a tray); ' +
  '{"kind":"allFull"} every tray in the bin is full; {"kind":"addTray","n":N} add N trays to the bin; ' +
  '{"kind":"finish"} the bin is done; {"kind":"shelf","shelf":N,"fridge":"name"} go to a shelf (omit fridge if not said); ' +
  '{"kind":"bin","query":"words"} open the bin named by those words (product or bin name); {"kind":"help"}. ' +
  'Rules: keep the order they were said; numbers are whole numbers; when someone corrects themselves ("twenty, no, twenty-one") keep only the final value; ' +
  'only include save, next, finish, allFull or addTray when they clearly asked for it; if nothing fits, return an empty commands list.';

export async function interpretCountVoice(
  input: { text: string } | { audioBase64: string; mimeType: string },
): Promise<VoiceInterpretation> {
  // `await` works whether getClient returns the client or a promise of it.
  const client = await getClient();
  const parts =
    'text' in input
      ? [{ text: `${VOICE_PROMPT}\n\nWhat they said: ${JSON.stringify(input.text.slice(0, 500))}` }]
      : [{ text: `${VOICE_PROMPT}\n\nThe audio clip is what they said.` }, { inlineData: { data: input.audioBase64, mimeType: input.mimeType } }];
  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0 },
  });
  if (!response.text) throw new Error('Gemini returned nothing for that.');
  const parsed = JSON.parse(response.text) as { transcript?: unknown; commands?: unknown };
  return {
    transcript: typeof parsed.transcript === 'string' ? parsed.transcript.trim() : 'text' in input ? input.text : '',
    commands: Array.isArray(parsed.commands) ? parsed.commands : [],
  };
}
