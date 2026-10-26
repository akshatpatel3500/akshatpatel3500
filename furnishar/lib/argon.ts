import { GoogleGenAI } from '@google/genai';

const MODEL = process.env.GEMINI_MODEL || 'gemini-4-argon';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-key-here') {
    throw new Error('GEMINI_API_KEY is not set');
  }
  // Created lazily so `next build` and key-less demos don't crash at import time.
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export function hasArgonKey(): boolean {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey && apiKey !== 'your-key-here');
}

export async function callArgon(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
    },
  });
  return response.text || '';
}

const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

/** Split a `data:image/jpeg;base64,...` URL into the inline-data part Gemini expects. */
function imagePart(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (!match) throw new Error('Image must be a base64 data URL');
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

/** Argon with an image attached (Room Analyzer in photo mode). Returns JSON text. */
export async function callArgonWithImage(
  systemPrompt: string,
  userPrompt: string,
  imageDataUrl: string,
): Promise<string> {
  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: userPrompt }, imagePart(imageDataUrl)] }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
    },
  });
  return response.text || '';
}

/** Edit a photo with Gemini's image model. Returns the new image as a data URL. */
export async function editImage(prompt: string, imageDataUrl: string): Promise<string> {
  const response = await getClient().models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }, imagePart(imageDataUrl)] }],
    config: { responseModalities: ['IMAGE'] },
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data);
  if (!image?.inlineData?.data) {
    const text = parts.map((p) => p.text).filter(Boolean).join(' ');
    throw new Error(text ? `Image model returned no image: ${text.slice(0, 160)}` : 'Image model returned no image');
  }
  return `data:${image.inlineData.mimeType ?? 'image/png'};base64,${image.inlineData.data}`;
}

/**
 * Pull a JSON object out of a model response. Handles raw JSON, ```json fences,
 * and JSON embedded in surrounding prose.
 */
export function extractJson<T = unknown>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as T;
    } catch {
      // fall through
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Last resort: strip trailing commas, a common LLM JSON mistake.
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')) as T;
    }
  }
  throw new Error('No JSON object found in model response');
}
