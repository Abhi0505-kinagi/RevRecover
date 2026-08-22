import { redisConnection } from '../config/redis';
import crypto from 'crypto';

const FAILURE_THRESHOLD = 5;       // Trip breaker if >= 5 failures occur
const WINDOW_MS = 38 * 1000;       // 38-second sliding window

export interface RailStatus {
  status: 'HEALTHY' | 'DEGRADED';
  failCount: number;
  recommendation?: string;
}

export class CircuitBreakerService {
  /**
   * Records a failure using a Redis Sorted Set (Rolling Sliding Window)
   */
  public static async recordFailure(railKey: string): Promise<number> {
    const now = Date.now();
    const key = `breaker:sliding:${railKey}`;
    const windowStart = now - WINDOW_MS;

    const pipeline = redisConnection.pipeline();
    
    // 1. Evict timestamps older than 38 seconds
    pipeline.zremrangebyscore(key, 0, windowStart);
    // 2. Add current failure timestamp
    pipeline.zadd(key, now, `${now}_${crypto.randomBytes(3).toString('hex')}`);
    // 3. Count remaining failures in the current 38-second sliding window
    pipeline.zcard(key);
    // 4. Set auto-cleanup TTL
    pipeline.expire(key, Math.ceil(WINDOW_MS / 1000) + 5);

    const results = await pipeline.exec();
    const failCount = (results?.[2]?.[1] as number) || 0;

    return failCount;
  }

  /**
   * Evaluates real-time health across all payment rails
   */
  public static async getCheckoutRailStatus(): Promise<Record<string, RailStatus>> {
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
    const result: Record<string, RailStatus> = {};

    const pipeline = redisConnection.pipeline();
    for (const rail of rails) {
      const key = `breaker:sliding:${rail}`;
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
    }

    const execResults = await pipeline.exec();

    rails.forEach((rail, index) => {
      // zcard result is at index * 2 + 1 in pipeline
      const failCount = (execResults?.[index * 2 + 1]?.[1] as number) || 0;

      if (failCount >= FAILURE_THRESHOLD) {
        result[rail] = {
          status: 'DEGRADED',
          failCount,
          recommendation: 'Bank server slow right now. Use UPI (Google Pay / PhonePe) for instant 10s checkout.',
        };
      } else {
        result[rail] = {
          status: 'HEALTHY',
          failCount,
        };
      }
    });

    return result;
  }
}