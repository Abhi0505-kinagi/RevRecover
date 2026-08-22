import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || '';

export const isGeminiConfigured = (): boolean => {
  return typeof apiKey === 'string' && apiKey.length > 20 && !apiKey.includes('dummy');
};
export const aiClient = new GoogleGenAI({ apiKey: apiKey || 'dummy_key_for_offline_fallback' });


