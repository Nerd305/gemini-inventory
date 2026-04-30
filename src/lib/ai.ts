import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function analyzeProductImage(base64Image: string) {
  try {
    const response = await ai.models.generateContent({
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

  const response = await ai.models.generateContent({
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

export async function countVialsInTray(base64Image: string) {
  try {
    // Validate image data
    if (!base64Image || !base64Image.includes('base64,')) {
      throw new Error('Invalid image format. Please upload a valid image.');
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Analyze this image of a medical vial tray. Count the exact number of vials visible in the tray. Return a JSON object with the following fields: "vialCount" (the exact number of vials), "confidence" (high/medium/low), and "notes" (any observations about the tray or vials). Return ONLY valid JSON. If no vials are detected, return vialCount as 0.' },
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
      const result = JSON.parse(response.text);
      // Validate the response structure
      if (typeof result.vialCount !== 'number' || result.vialCount < 0) {
        throw new Error('Invalid response from AI model');
      }
      return result;
    }
    throw new Error('No response from AI model');
  } catch (error) {
    console.error("Error counting vials:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to analyze vial tray. Please try again.');
  }
}
