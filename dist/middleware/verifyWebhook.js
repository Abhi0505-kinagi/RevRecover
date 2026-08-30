"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.idempotencyGuard = exports.verifyWebhookSignature = void 0;
const crypto_1 = __importDefault(require("crypto"));
const redis_1 = require("../config/redis");
const verifyWebhookSignature = (req, res, next) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret';
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
        res.status(400).json({ error: 'Missing X-Razorpay-Signature header' });
        return;
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
        res.status(400).json({ error: 'Raw body buffer missing' });
        return;
    }
    const expectedSignature = crypto_1.default
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
    const sigBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (sigBuffer.length !== expectedBuffer.length) {
        res.status(401).json({ error: 'Invalid webhook signature length' });
        return;
    }
    const isValid = crypto_1.default.timingSafeEqual(sigBuffer, expectedBuffer);
    if (!isValid) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
    }
    next();
};
exports.verifyWebhookSignature = verifyWebhookSignature;
const idempotencyGuard = async (req, res, next) => {
    try {
        const eventPayload = req.body;
        const eventName = eventPayload?.event || 'generic_event';
        const paymentId = eventPayload?.payload?.payment?.entity?.id || eventPayload?.id;
        if (!paymentId) {
            next();
            return;
        }
        // Event-scoped atomic lock (e.g. lock:webhook:payment.captured:pay_12345)
        const lockKey = `lock:webhook:${eventName}:${paymentId}`;
        const acquired = await redis_1.redisConnection.set(lockKey, 'PROCESSED', 'EX', 86400, 'NX');
        if (!acquired) {
            // Duplicate event delivery: Discard duplicate and return HTTP 200
            res.status(200).json({ status: 'ignored', message: `Duplicate ${eventName} event dropped` });
            return;
        }
        next();
    }
    catch (error) {
        console.error('Idempotency check error:', error);
        next();
    }
};
exports.idempotencyGuard = idempotencyGuard;
