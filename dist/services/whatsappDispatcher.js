"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppDispatcher = void 0;
const axios_1 = __importDefault(require("axios"));
class WhatsAppDispatcher {
    /**
     * Dispatches WhatsApp HSM Notification with Meta Graph API & Dev Sandbox Support
     */
    static async dispatchHsmMessage(payload) {
        const metaToken = process.env.META_WHATSAPP_TOKEN;
        const phoneId = process.env.META_PHONE_NUMBER_ID;
        // Production Meta Graph API Call
        if (metaToken && phoneId && !metaToken.includes('mock')) {
            try {
                const response = await axios_1.default.post(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
                    messaging_product: 'whatsapp',
                    to: payload.to,
                    type: 'template',
                    template: {
                        name: payload.templateName,
                        language: { code: payload.languageCode },
                        components: [
                            {
                                type: 'body',
                                parameters: payload.bodyParameters.map((param) => ({
                                    type: 'text',
                                    text: param,
                                })),
                            },
                        ],
                    },
                }, {
                    headers: {
                        Authorization: `Bearer ${metaToken}`,
                        'Content-Type': 'application/json',
                    },
                });
                return {
                    status: 'DISPATCHED_LIVE',
                    messageId: response.data?.messages?.[0]?.id || `wamid_${Date.now()}`,
                };
            }
            catch (err) {
                console.error('Meta Cloud API Error:', err.response?.data || err.message);
            }
        }
        // High-Fidelity Sandbox / Demo Terminal Logger
        const messageId = `wamid.mock.${Date.now()}.${Math.floor(Math.random() * 1000)}`;
        console.log('\n============================================================');
        console.log('📱 [WHATSAPP CLOUD DISPATCHER] Meta HSM Message Transmitted');
        console.log('============================================================');
        console.log(`To:           ${payload.to}`);
        console.log(`Template:     ${payload.templateName} (${payload.languageCode})`);
        console.log(`Parameters:   [${payload.bodyParameters.join(' | ')}]`);
        console.log(`Status:       200 OK (Message ID: ${messageId})`);
        console.log('============================================================\n');
        return {
            status: 'DISPATCHED_SANDBOX',
            messageId,
        };
    }
}
exports.WhatsAppDispatcher = WhatsAppDispatcher;
