import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || '';

export const isGeminiConfigured = (): boolean => {
  return typeof apiKey === 'string' && apiKey.length > 20 && !apiKey.includes('dummy');
};

export const getGeminiClient = async () => {
  try {
    const { GoogleGenAI } = await import('@google/genai');
    return new GoogleGenAI({
      apiKey: apiKey || 'dummy_key_for_offline_fallback',
    });
  } catch {
    return null;
  }
};

export const aiClient = null;


