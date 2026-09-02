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

