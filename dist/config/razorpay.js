"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiClient = exports.razorpayClient = void 0;
const razorpay_1 = __importDefault(require("razorpay"));
const genai_1 = require("@google/genai");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.razorpayClient = new razorpay_1.default({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret',
});
exports.aiClient = new genai_1.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || 'dummy_gemini_key',
});
