import { redisConnection } from '../config/redis';
import crypto from 'crypto';

const FAILURE_THRESHOLD = 5;
const WINDOW_MS = 38 * 1000;

export interface RailHealth {
  status: 'HEALTHY' | 'DEGRADED';
  failCount: number;
  priorityRank: number; // 1 = top of checkout list
  badge?: string;
  smartFallback?: {
    suggestedRail: string;
    action: 'AUTO_SWITCH_UPI' | 'SHOW_ALERT';
    promptText: string;
  };
}

export class CircuitBreakerService {
  public static async recordFailure(railKey: string): Promise<number> {
    const now = Date.now();
    const key = `breaker:sliding:${railKey}`;
    const windowStart = now - WINDOW_MS;

    const pipeline = redisConnection.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}_${crypto.randomBytes(3).toString('hex')}`);
    pipeline.zcard(key);
    pipeline.expire(key, Math.ceil(WINDOW_MS / 1000) + 5);

    const results = await pipeline.exec();
    return (results?.[2]?.[1] as number) || 0;
  }

  public static async getCheckoutRailStatus(): Promise<Record<string, RailHealth>> {
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
    const pipeline = redisConnection.pipeline();

    for (const rail of rails) {
      const key = `breaker:sliding:${rail}`;
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
    }

    const execResults = await pipeline.exec();
    const output: Record<string, RailHealth> = {};

    rails.forEach((rail, index) => {
      const failCount = (execResults?.[index * 2 + 1]?.[1] as number) || 0;
      const isDegraded = failCount >= FAILURE_THRESHOLD;

      if (rail === 'upi') {
        output[rail] = {
          status: 'HEALTHY',
          failCount,
          priorityRank: 1, // UPI always promoted to primary slot
          badge: '⚡ 99.8% Success Rate (Instant)',
        };
        return;
      }

      if (isDegraded) {
        const bankName = rail.replace('netbanking_', '').toUpperCase();
        output[rail] = {
          status: 'DEGRADED',
          failCount,
          priorityRank: 99, // Demote to bottom of list
          badge: 'High Bank Latency',
          smartFallback: {
            suggestedRail: 'upi',
            action: 'AUTO_SWITCH_UPI',
            promptText: `${bankName} Netbanking has high network latency. Complete seamlessly using ${bankName} UPI instead?`,
          },
        };
      } else {
        output[rail] = {
          status: 'HEALTHY',
          failCount,
          priorityRank: 2,
        };
      }
    });

    return output;
  }
}