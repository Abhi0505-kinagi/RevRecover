"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreakerService = void 0;
const redis_1 = require("../config/redis");
const crypto_1 = __importDefault(require("crypto"));
const FAILURE_THRESHOLD = 5; // Trip breaker if >= 5 failures occur
const WINDOW_MS = 38 * 1000; // 38-second sliding window
class CircuitBreakerService {
    /**
     * Records a failure using a Redis Sorted Set (Rolling Sliding Window)
     */
    static async recordFailure(railKey) {
        const now = Date.now();
        const key = `breaker:sliding:${railKey}`;
        const windowStart = now - WINDOW_MS;
        const pipeline = redis_1.redisConnection.pipeline();
        // 1. Evict timestamps older than 38 seconds
        pipeline.zremrangebyscore(key, 0, windowStart);
        // 2. Add current failure timestamp
        pipeline.zadd(key, now, `${now}_${crypto_1.default.randomBytes(3).toString('hex')}`);
        // 3. Count remaining failures in the current 38-second sliding window
        pipeline.zcard(key);
        // 4. Set auto-cleanup TTL
        pipeline.expire(key, Math.ceil(WINDOW_MS / 1000) + 5);
        const results = await pipeline.exec();
        const failCount = results?.[2]?.[1] || 0;
        return failCount;
    }
    /**
     * Evaluates real-time health across all payment rails
     */
    static async getCheckoutRailStatus() {
        const rails = [
            'upi',
            'netbanking_HDFC',
            'netbanking_ICICI',
            'netbanking_SBI',
            'netbanking_AXIS',
            'card_visa',
            'card_mastercard',
        ];
        const now = Date.now();
        const windowStart = now - WINDOW_MS;
        const result = {};
        const pipeline = redis_1.redisConnection.pipeline();
        for (const rail of rails) {
            const key = `breaker:sliding:${rail}`;
            pipeline.zremrangebyscore(key, 0, windowStart);
            pipeline.zcard(key);
        }
        const execResults = await pipeline.exec();
        rails.forEach((rail, index) => {
            // zcard result is at index * 2 + 1 in pipeline
            const failCount = execResults?.[index * 2 + 1]?.[1] || 0;
            if (failCount >= FAILURE_THRESHOLD) {
                result[rail] = {
                    status: 'DEGRADED',
                    failCount,
                    recommendation: 'Bank server slow right now. Use UPI (Google Pay / PhonePe) for instant 10s checkout.',
                };
            }
            else {
                result[rail] = {
                    status: 'HEALTHY',
                    failCount,
                };
            }
        });
        return result;
    }
}
exports.CircuitBreakerService = CircuitBreakerService;
