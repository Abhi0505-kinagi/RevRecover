"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiClient = exports.getGeminiClient = exports.isGeminiConfigured = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const apiKey = process.env.GEMINI_API_KEY || '';
const isGeminiConfigured = () => {
    return typeof apiKey === 'string' && apiKey.length > 20 && !apiKey.includes('dummy');
};
exports.isGeminiConfigured = isGeminiConfigured;
const getGeminiClient = async () => {
    try {
        const { GoogleGenAI } = await import('@google/genai');
        return new GoogleGenAI({
            apiKey: apiKey || 'dummy_key_for_offline_fallback',
        });
    }
    catch {
        return null;
    }
};
exports.getGeminiClient = getGeminiClient;
exports.aiClient = null;
