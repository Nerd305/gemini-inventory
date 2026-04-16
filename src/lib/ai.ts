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
