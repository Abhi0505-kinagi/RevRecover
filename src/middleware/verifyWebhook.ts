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
    const eventPayload = req.body;
    const eventName = eventPayload?.event || 'generic_event';
    const paymentId = eventPayload?.payload?.payment?.entity?.id || eventPayload?.id;

    if (!paymentId) {
      next();
      return;
    }

    // Event-scoped atomic lock (e.g. lock:webhook:payment.captured:pay_12345)
    const lockKey = `lock:webhook:${eventName}:${paymentId}`;
    const acquired = await redisConnection.set(lockKey, 'PROCESSED', 'EX', 86400, 'NX');

    if (!acquired) {
      // Duplicate event delivery: Discard duplicate and return HTTP 200
      res.status(200).json({ status: 'ignored', message: `Duplicate ${eventName} event dropped` });
      return;
    }

    next();
  } catch (error) {
    console.error('Idempotency check error:', error);
    next();
  }
};