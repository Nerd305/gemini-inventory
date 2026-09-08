/**
 * Gemini vial counting over plain fetch (the @google/genai SDK is not needed in
 * React Native). Returns the count plus bounding boxes so the app can draw the
 * "visual counter" overlay on the photo for the user to verify.
 */
export interface VialBox {
  /** Percent of image width/height, top-left origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  capColor?: string;
}

export interface TrayCountResult {
  vialCount: number;
  confidence: string;
  notes?: string;
  detections: VialBox[];
}

const MODEL = 'gemini-2.5-flash';

const PROMPT =
  'You are counting medication vials in a photo of one tray inside a pharmacy fridge. ' +
  'Count every vial visible in the tray (the tray holds at most 25). ' +
  'Return ONLY valid JSON of the shape ' +
  '{"vialCount": number, "confidence": "high"|"medium"|"low", "notes": string, ' +
  '"detections": [{"x": number, "y": number, "w": number, "h": number, "capColor": "#rrggbb"}]}. ' +
  'Put exactly one detection per counted vial; x, y, w, h are percentages (0-100) of the image ' +
  'width and height with (x, y) the top-left corner of the vial cap. ' +
  'If no vials are visible return {"vialCount": 0, "confidence": "high", "notes": "", "detections": []}.';

function apiKey(): string {
  const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!key) {
    throw new Error('Missing EXPO_PUBLIC_GEMINI_API_KEY. Copy mobile/.env.example to mobile/.env and restart expo.');
  }
  return key;
}

function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('AI returned no JSON');
  }
}

export async function countVialsInTrayImage(base64Jpeg: string): Promise<TrayCountResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: base64Jpeg } }],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const parsed = parseJsonLoose(text) as Partial<TrayCountResult> & { detections?: unknown };

  const vialCount = Number(parsed.vialCount);
  if (!Number.isFinite(vialCount) || vialCount < 0) throw new Error('AI returned an invalid count');

  const rawBoxes = Array.isArray(parsed.detections) ? parsed.detections : [];
  const detections: VialBox[] = rawBoxes
    .map((d: any) => ({
      x: Number(d?.x),
      y: Number(d?.y),
      w: Number(d?.w),
      h: Number(d?.h),
      capColor: typeof d?.capColor === 'string' ? d.capColor : undefined,
    }))
    .filter((d) => [d.x, d.y, d.w, d.h].every(Number.isFinite) && d.w > 0 && d.h > 0);

  return {
    vialCount: Math.round(vialCount),
    confidence: typeof parsed.confidence === 'string' ? parsed.confidence : 'unknown',
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
    detections,
  };
}

/**
 * Transcribe a short spoken inventory command ("four trays and twenty two vials",
 * "shelf 3", "fridge 2 peptides"). Returns the plain transcript; parsing happens
 * in the shared voice-command parser so typed and spoken input behave the same.
 */
export async function transcribeCommand(base64Audio: string, mimeType: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'This audio is a short spoken command from a pharmacist counting vials in a fridge. ' +
                  'Transcribe it word for word in English. Write numbers as digits. ' +
                  'Product names may be peptides such as BPC-157, TB-500, Semaglutide, Tirzepatide, Retatrutide, NAD, Sermorelin, GHK-Cu. ' +
                  'Return ONLY JSON: {"transcript": string}. If nothing intelligible was said return {"transcript": ""}.',
              },
              { inlineData: { mimeType, data: base64Audio } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const parsed = parseJsonLoose(text) as { transcript?: unknown };
  return typeof parsed.transcript === 'string' ? parsed.transcript.trim() : '';
}
