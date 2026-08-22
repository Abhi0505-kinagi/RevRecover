"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PtpService = void 0;
const genai_1 = require("@google/genai");
const razorpay_1 = require("../config/razorpay");
const Invoice_1 = require("../models/Invoice");
const PtpExtractionSchema = {
    type: genai_1.Type.OBJECT,
    properties: {
        intent: {
            type: genai_1.Type.STRING,
            description: 'PROMISE_TO_PAY | DISPUTE | ALREADY_PAID | REFUSAL | GENERAL_QUERY',
        },
        ptpDate: {
            type: genai_1.Type.STRING,
            description: 'ISO 8601 Date string (YYYY-MM-DD) if a promise to pay was detected, else empty.',
        },
        confidenceScore: {
            type: genai_1.Type.NUMBER,
            description: 'Confidence score between 0.0 and 1.0',
        },
        aiSummary: {
            type: genai_1.Type.STRING,
            description: 'Concise explanation of the customer response',
        },
        suggestedReply: {
            type: genai_1.Type.STRING,
            description: 'Polite, professional confirmation message acknowledging the date.',
        },
    },
    required: ['intent', 'confidenceScore', 'aiSummary', 'suggestedReply'],
};
class PtpService {
    /**
     * Processes an incoming WhatsApp/Email reply from a B2B client
     */
    static async processClientReply(invoiceId, clientMessage) {
        const invoice = await Invoice_1.Invoice.findOne({ invoiceId });
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
        const response = await razorpay_1.aiClient.models.generateContent({
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
    static async reconcileBrokenPromises() {
        const now = new Date();
        // Find all invoices where PTP date passed without payment
        const brokenInvoices = await Invoice_1.Invoice.find({
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
exports.PtpService = PtpService;
