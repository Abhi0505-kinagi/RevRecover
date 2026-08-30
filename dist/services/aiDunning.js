"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiDunningService = void 0;
const gemini_1 = require("../config/gemini");
const razorpay_1 = require("../config/razorpay");
const whatsappDispatcher_1 = require("./whatsappDispatcher");
const razorpay_2 = require("../config/razorpay");
const DunningSchema = {
    type: 'OBJECT',
    properties: {
        messageBody: {
            type: 'STRING',
            description: 'Concise, empathetic explanation under 140 characters explaining the drop-off and offering 1-click retry.',
        },
        urgencyTone: {
            type: 'STRING',
            description: 'EMPATHETIC | ACTION_ORIENTED | REASSURING',
        },
    },
    required: ['messageBody', 'urgencyTone'],
};
class AiDunningService {
    static sanitizeFirstName(nameOrEmail) {
        if (!nameOrEmail)
            return 'Customer';
        const clean = nameOrEmail.split('@')[0].replace(/[^a-zA-Z]/g, '');
        return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() || 'Customer';
    }
    static maskContact(contact) {
        const cleanDigits = (contact || '').replace(/\D/g, '');
        return cleanDigits.length > 4
            ? cleanDigits.slice(0, -4).replace(/./g, '*') + cleanDigits.slice(-4)
            : '******';
    }
    // public static async createRecoveryPaymentLink(
    //   paymentId: string,
    //   amount: number,
    //   email?: string,
    //   contact?: string,
    //   invoiceId?: string,
    //   originalPaymentId?: string
    // ): Promise<string> {
    //   try {
    //     const link: any = await razorpayClient.paymentLink.create({
    //       amount,
    //       currency: 'INR',
    //       accept_partial: false,
    //       reference_id: `rec_${paymentId}_${Date.now()}`,
    //       description: 'Instant 1-Click Payment Recovery via UPI / Cards',
    //       customer: {
    //         name: this.sanitizeFirstName(email),
    //         email: email || 'customer@example.com',
    //         contact: contact || '+919999999999',
    //       },
    //       notify: { sms: false, email: false },
    //       reminder_enable: false,
    //       //notes: invoiceId ? { invoiceId } : undefined,
    //       notes: invoiceId ? { invoiceId } : originalPaymentId ? { originalPaymentId } : undefined,
    //     });
    //     return link.short_url;
    //   } catch {
    //     return `https://rzp.io/i/rec_${paymentId.slice(-8)}`;
    //   }
    // }
    static async createRecoveryPaymentLink(paymentId, amount, email, contact, invoiceId, originalPaymentId) {
        try {
            const link = await razorpay_1.razorpayClient.paymentLink.create({
                amount: Math.round(amount),
                currency: 'INR',
                accept_partial: false,
                reference_id: paymentId, // Keep it clean and matching your primary identifier
                description: 'Instant 1-Click Payment Recovery',
                customer: {
                    name: this.sanitizeFirstName(email),
                    email: email || 'customer@example.com',
                    contact: contact || '+919999999999',
                },
                notify: { sms: false, email: false },
                reminder_enable: false,
                notes: invoiceId ? { invoiceId } : originalPaymentId ? { originalPaymentId } : undefined,
            });
            if (!link || !link.short_url) {
                throw new Error(`Razorpay returned empty short_url for paymentId: ${paymentId}`);
            }
            console.log(link);
            return { url: link.short_url, orderId: link.order_id || null };
        }
        catch (error) {
            // Log the exact Razorpay API rejection reason to your terminal
            console.error('❌ Razorpay Payment Link Generation Failed:', error?.error || error);
            throw error; // Let the worker know it failed or handle it gracefully
        }
    }
    static async generateRecoveryMessage(customerName, amount, errorReason, paymentLink, isDebitedRisk, recipientContact = '+919876543210') {
        const cleanName = this.sanitizeFirstName(customerName);
        const amountInRupees = (0, razorpay_2.formatRazorpayAmount)(amount, 'INR');
        let messageBody = '';
        // Step 1: LLM Generation or Resilient Heuristic Fallback
        const geminiClient = await (0, gemini_1.getGeminiClient)();
        if ((0, gemini_1.isGeminiConfigured)() && geminiClient && process.env.BENCHMARK_MODE !== 'true') {
            try {
                const prompt = `
        Generate a zero-PII recovery message in conversational Hinglish.
        Customer Name: ${cleanName}
        Amount: ${amountInRupees}
        Failure Reason: ${errorReason}
        Money Debited Risk: ${isDebitedRisk ? 'YES - Reassure customer money is safe' : 'NO'}

        Rules:
        - Keep message body under 140 characters.
        - Strict HSM template variable safety.
        `;
                const response = await geminiClient.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: DunningSchema,
                        temperature: 0.2,
                    },
                });
                const parsed = JSON.parse(response.text || '{}');
                messageBody = parsed.messageBody;
            }
            catch {
                // Handled by fallback below
            }
        }
        // Deterministic fallback if offline or exceeding limits
        if (!messageBody) {
            messageBody = isDebitedRisk
                ? `Hi ${cleanName}, ${amountInRupees} payment pause hua. Agar paise kate hain to safe hain.`
                : `Hi ${cleanName}, ${amountInRupees} payment complete nahi hua. 1-click me retry karein:`;
        }
        // Step 2: Hard Enforcement of Meta HSM 140-Character Constraint
        const truncatedBody = messageBody.length > 140 ? messageBody.slice(0, 137) + '...' : messageBody;
        // Step 3: Select Template ID Deterministically
        const templateId = isDebitedRisk ? 'HSM_PAYMENT_LATE_AUTH_V1' : 'HSM_PAYMENT_RECOVERY_V2';
        const maskedPhone = this.maskContact(recipientContact);
        // Step 4: Real / Sandbox WhatsApp Transmission
        const dispatchResult = await whatsappDispatcher_1.WhatsAppDispatcher.dispatchHsmMessage({
            to: recipientContact,
            templateName: templateId.toLowerCase(),
            languageCode: 'en_IN',
            bodyParameters: [cleanName, `${amountInRupees}`, paymentLink],
        });
        const fullMessage = `${truncatedBody}\n🔗 ${paymentLink}\n🔒 Verified by Razorpay Secure`;
        return {
            templateId,
            text: fullMessage,
            maskedPhone,
            dispatchResult,
        };
    }
}
exports.AiDunningService = AiDunningService;
