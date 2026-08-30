"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const payload = {
    entity: 'event', account_id: 'acc_manual', event: 'payment.failed', contains: ['payment'],
    payload: { payment: { entity: {
                id: `pay_manualB_${Date.now()}`,
                amount: 10000, currency: 'INR', status: 'failed',
                error_code: 'BAD_REQUEST_ERROR',
                error_source: 'customer',
                error_reason: 'card_declined',
                error_step: 'payment_authorization',
                email: 'test3@example.com', contact: '+917259550891',
                created_at: Math.floor(Date.now() / 1000),
            } } },
};
const sig = crypto_1.default.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(JSON.stringify(payload)).digest('hex');
axios_1.default.post('http://localhost:5000/api/webhooks/razorpay', payload, {
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig },
}).then(r => console.log('Sent:', r.data)).catch(e => console.error(e.response?.data || e.message));
