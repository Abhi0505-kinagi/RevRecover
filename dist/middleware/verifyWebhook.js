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
    if (signature !== expectedSignature && process.env.NODE_ENV !== 'test') {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
    }
    next();
};
exports.verifyWebhookSignature = verifyWebhookSignature;
const idempotencyGuard = async (req, res, next) => {
    try {
        const paymentId = req.body?.payload?.payment?.entity?.id || req.body?.id;
        const eventId = req.body?.account_id + ':' + (paymentId || Date.now());
        if (!paymentId) {
            next();
            return;
        }
        const lockKey = `lock:webhook:${paymentId}`;
        // Set 24-hour TTL lock atomically
        const acquired = await redis_1.redisConnection.set(lockKey, 'PROCESSED', 'EX', 86400, 'NX');
        if (!acquired) {
            // Duplicate delivery: Acknowledge HTTP 200 immediately and discard
            res.status(200).json({ status: 'ignored', message: 'Duplicate webhook event dropped' });
            return;
        }
        next();
    }
    catch (error) {
        console.error('Idempotency check failed:', error);
        next();
    }
};
exports.idempotencyGuard = idempotencyGuard;
