import { GoogleGenAI, Type, Schema } from '@google/genai';
import { aiClient } from '../config/razorpay';
import { Invoice } from '../models/Invoice';

const PtpExtractionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      description: 'PROMISE_TO_PAY | DISPUTE | ALREADY_PAID | REFUSAL | GENERAL_QUERY',
    },
    ptpDate: {
      type: Type.STRING,
      description: 'ISO 8601 Date string (YYYY-MM-DD) if a promise to pay was detected, else empty.',
    },
    confidenceScore: {
      type: Type.NUMBER,
      description: 'Confidence score between 0.0 and 1.0',
    },
    aiSummary: {
      type: Type.STRING,
      description: 'Concise explanation of the customer response',
    },
    suggestedReply: {
      type: Type.STRING,
      description: 'Polite, professional confirmation message acknowledging the date.',
    },
  },
  required: ['intent', 'confidenceScore', 'aiSummary', 'suggestedReply'],
};

export class PtpService {
  /**
   * Processes an incoming WhatsApp/Email reply from a B2B client
   */
  public static async processClientReply(invoiceId: string, clientMessage: string) {
    const invoice = await Invoice.findOne({ invoiceId });
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found.`);
    }

    const todayIso = new Date().toISOString().split('T')[0];

    const prompt = `
Current Reference Date: ${todayIso}
Context: B2B Invoice ${invoice.invoiceId} for ₹${(invoice.amount / 100).toLocaleString('en-IN')} is overdue.
Client (${invoice.clientName}) sent this message:
"${clientMessage}"

Analyze the message:
1. Extract if the client gives a Promise-to-Pay (PTP) commitment with a target date (e.g. "by Friday", "end of this month", "on 28th August").
2. Calculate the exact ISO date (YYYY-MM-DD) based on the reference date ${todayIso}.
3. Generate a warm, professional confirmation message locking in that date.
`;

    const response = await aiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: PtpExtractionSchema,
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text || '{}');

    // Update state machine if a valid PTP date was negotiated
    if (parsed.intent === 'PROMISE_TO_PAY' && parsed.ptpDate) {
      invoice.status = 'PROMISE_TO_PAY';
      invoice.ptpDate = new Date(parsed.ptpDate);
      invoice.ptpNotes = parsed.aiSummary;
      await invoice.save();
    }

    return {
      invoiceId: invoice.invoiceId,
      updatedStatus: invoice.status,
      parsedIntent: parsed.intent,
      ptpDate: parsed.ptpDate || null,
      aiReply: parsed.suggestedReply,
      summary: parsed.aiSummary,
    };
  }

  /**
   * Evaluates PTP compliance (called by daily cron or worker)
   */
  public static async reconcileBrokenPromises(): Promise<number> {
    const now = new Date();
    
    // Find all invoices where PTP date passed without payment
    const brokenInvoices = await Invoice.find({
      status: 'PROMISE_TO_PAY',
      ptpDate: { $lt: now },
    });

    for (const inv of brokenInvoices) {
      inv.status = 'PTP_BROKEN';
      inv.escalationLevel = Math.min(inv.escalationLevel + 1, 3);
      await inv.save();
    }

    return brokenInvoices.length;
  }
}