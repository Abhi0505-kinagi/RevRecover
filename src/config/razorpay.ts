import Razorpay from 'razorpay';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

export const razorpayClient = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret',
});

export const aiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || 'dummy_gemini_key',
});