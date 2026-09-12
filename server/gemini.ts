import { GoogleGenAI } from "@google/genai";

let genAIClient: GoogleGenAI | null = null;

export const getGeminiAI = (): GoogleGenAI | null => {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey || apiKey === "undefined" || apiKey === "null") {
    return null;
  }

  if (!genAIClient) {
    try {
      genAIClient = new GoogleGenAI({ apiKey });
    } catch (err: any) {
      console.warn("⚠️ [Gemini AI Init Notice]:", err?.message || err);
      return null;
    }
  }
  return genAIClient;
};

export interface ResilientGenOptions {
  model?: string;
  fallbackModels?: string[];
  contents: string;
  config?: any;
  maxRetries?: number;
}

/**
 * Executes Gemini content generation with automated exponential backoff
 * and multi-model fallback to seamlessly survive 503 high demand spikes or 429 rate limits.
 */
export async function generateContentResilient(
  options: ResilientGenOptions
): Promise<{ text: string; modelUsed: string }> {
  const ai = getGeminiAI();
  if (!ai) {
    throw new Error("Gemini AI client not configured or GEMINI_API_KEY is missing");
  }

  const primaryModel = options.model || "gemini-3.8-flash";
  const candidateModels = [
    primaryModel,
    ...(options.fallbackModels || ["gemini-2.5-flash", "gemini-2.5-pro"]),
  ].filter((m, i, arr) => arr.indexOf(m) === i);

  let lastError: any = null;

  for (const model of candidateModels) {
    const retries = options.maxRetries ?? 2;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: options.contents,
          config: options.config,
        });

        const text = response.text || "";
        return { text, modelUsed: model };
      } catch (err: any) {
        lastError = err;
        const msg = err?.message || "";
        const status = err?.status || err?.code;
        const isTransient =
          status === 503 ||
          status === 429 ||
          /high demand|temporar|unavailable|overloaded|rate limit|quota/i.test(msg);

        if (isTransient && attempt < retries) {
          const delay = 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // Try next fallback model if transient error persisted
        break;
      }
    }
  }

  throw lastError || new Error("All candidate Gemini models failed to generate content");
}

