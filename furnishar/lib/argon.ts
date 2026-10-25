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
