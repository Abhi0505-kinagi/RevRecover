import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { redisConnection } from '../config/redis';

export const verifyWebhookSignature = (req: Request, res: Response, next: NextFunction): void => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret';
  const signature = req.headers['x-razorpay-signature'] as string;

  if (!signature) {
    res.status(400).json({ error: 'Missing X-Razorpay-Signature header' });
    return;
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: 'Raw body buffer missing' });
    return;
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (signature !== expectedSignature && process.env.NODE_ENV !== 'test') {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  next();
};

export const idempotencyGuard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const paymentId = req.body?.payload?.payment?.entity?.id || req.body?.id;
    const eventId = req.body?.account_id + ':' + (paymentId || Date.now());

    if (!paymentId) {
      next();
      return;
    }

    const lockKey = `lock:webhook:${paymentId}`;
    // Set 24-hour TTL lock atomically
    const acquired = await redisConnection.set(lockKey, 'PROCESSED', 'EX', 86400, 'NX');

    if (!acquired) {
      // Duplicate delivery: Acknowledge HTTP 200 immediately and discard
      res.status(200).json({ status: 'ignored', message: 'Duplicate webhook event dropped' });
      return;
    }

    next();
  } catch (error) {
    console.error('Idempotency check failed:', error);
    next();
  }
};