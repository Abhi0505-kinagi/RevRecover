"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PtpService = void 0;
const gemini_1 = require("../config/gemini");
const Invoice_1 = require("../models/Invoice");
const razorpay_1 = require("../config/razorpay");
const recoveryQueues_1 = require("../queues/recoveryQueues");
const PtpExtractionSchema = {
    type: 'OBJECT',
    properties: {
        intent: {
            type: 'STRING',
            description: 'PROMISE_TO_PAY | DISPUTE | ALREADY_PAID | REFUSAL | GENERAL_QUERY',
        },
        ptpDate: {
            type: 'STRING',
            description: 'ISO 8601 Date string (YYYY-MM-DD) if detected, else empty string.',
        },
        confidenceScore: {
            type: 'NUMBER',
            description: 'Score between 0.0 and 1.0',
        },
        aiSummary: {
            type: 'STRING',
            description: 'Summary under 100 characters',
        },
        suggestedReply: {
            type: 'STRING',
            description: 'Polite confirmation message',
        },
    },
    required: ['intent', 'confidenceScore', 'aiSummary', 'suggestedReply'],
};
class PtpService {
    /**
     * Sanitizes untrusted user text before passing to the LLM
     */
    static sanitizeMessage(raw) {
        return raw
            .replace(/[{}\[\]<>]/g, '') // Strip brackets and tags
            .replace(/[\r\n]+/g, ' ') // Flatten multi-line injection attempts
            .trim()
            .slice(0, 250); // Strict 250-character ceiling
    }
    /**
     * Deterministic Regex Parser for Offline / Zero-Cost Executions
     */
    static parseCommitmentFallback(sanitizedText, clientName, amount) {
        const text = sanitizedText.toLowerCase();
        const today = new Date();
        let ptpDate = null;
        const isoMatch = text.match(/\b(202\d-\d{2}-\d{2})\b/);
        const monthDayMatch = text.match(/\b(august|aug|september|sept|october|oct|november|nov|december|dec|january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul)\s+(\d{1,2})\b/i);
        if (isoMatch) {
            ptpDate = isoMatch[1];
        }
        else if (monthDayMatch) {
            const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const mStr = monthDayMatch[1].slice(0, 3).toLowerCase();
            const monthIdx = monthNames.indexOf(mStr);
            const day = parseInt(monthDayMatch[2], 10);
            if (monthIdx !== -1) {
                ptpDate = new Date(Date.UTC(today.getFullYear(), monthIdx, day)).toISOString().split('T')[0];
            }
        }
        else if (text.includes('friday')) {
            const nextFri = new Date();
            nextFri.setDate(today.getDate() + ((7 - today.getDay() + 5) % 7 || 7));
            ptpDate = nextFri.toISOString().split('T')[0];
        }
        const hasPromise = /pay|clear|release|settle|transfer|batch/i.test(text);
        return {
            intent: hasPromise && ptpDate ? 'PROMISE_TO_PAY' : 'GENERAL_QUERY',
            ptpDate: ptpDate || today.toISOString().split('T')[0],
            confidenceScore: 0.95,
            aiSummary: `Customer committed to clear payment on ${ptpDate || 'scheduled date'}.`,
            suggestedReply: `Thank you for confirming, ${clientName.split(' ')[0]}. We have noted your payment schedule of ${(0, razorpay_1.formatRazorpayAmount)(amount, 'INR')} for ${ptpDate}.`,
        };
    }
    static async processClientReply(invoiceId, clientMessage) {
        const invoice = await Invoice_1.Invoice.findOne({ invoiceId });
        if (!invoice) {
            throw new Error(`Invoice ${invoiceId} not found.`);
        }
        const sanitized = this.sanitizeMessage(clientMessage);
        const todayIso = new Date().toISOString().split('T')[0];
        let parsed;
        const geminiClient = await (0, gemini_1.getGeminiClient)();
        if ((0, gemini_1.isGeminiConfigured)() && geminiClient) {
            try {
                const prompt = `
          Current Reference Date: ${todayIso}
          Context: B2B Invoice ${invoice.invoiceId} for ${(0, razorpay_1.formatRazorpayAmount)(invoice.amount, invoice.currency || 'INR')} is overdue.
          Client (${invoice.clientName}) sent: "${sanitized}"
          Extract intent, ISO payment date, and generate a polite confirmation reply.
          `;
                const response = await geminiClient.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: PtpExtractionSchema,
                        temperature: 0.1,
                    },
                });
                parsed = JSON.parse(response.text || '{}');
            }
            catch {
                parsed = this.parseCommitmentFallback(sanitized, invoice.clientName, invoice.amount);
            }
        }
        else {
            parsed = this.parseCommitmentFallback(sanitized, invoice.clientName, invoice.amount);
        }
        const hasDate = Boolean(parsed.ptpDate && String(parsed.ptpDate).trim().length >= 8);
        const hasIntent = /PROMISE|PAY|SETTLE|CLEAR|BATCH/i.test(String(parsed.intent || ''));
        if (hasDate || hasIntent) {
            invoice.status = 'PROMISE_TO_PAY';
            invoice.ptpDate = hasDate ? new Date(parsed.ptpDate) : new Date(Date.now() + 7 * 86400000);
            invoice.ptpNotes = parsed.aiSummary || 'Customer committed to clear overdue balance.';
            await invoice.save();
            // Schedule a watchdog check for right after the promised date passes.
            const delayMs = Math.max(0, invoice.ptpDate.getTime() - Date.now()) + 60000; // +1min grace
            await recoveryQueues_1.ptpWatchdogQueue.add('check-ptp-breach', { invoiceId: invoice._id.toString() }, { delay: delayMs });
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
    static async reconcileBrokenPromises() {
        const now = new Date();
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
