import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { RecoveryLedger } from '../models/RecoveryLedger';
import { AiDunningService } from '../services/aiDunning';
import { TriageService } from '../services/triageMatrix';

// Define BullMQ Queues
export const routeAQueue = new Queue('route-a-silent-retries', { connection: redisConnection as any });
export const routeBQueue = new Queue('route-b-agentic-dunning', { connection: redisConnection as any });

/**
 * Worker for Route A: Silent 1m -> 2m -> 5m 5XX Retries
 */
export const routeAWorker = new Worker(
  'route-a-silent-retries',
  async (job: Job) => {
    const { paymentId, amount, retryCount } = job.data;
    console.log(`[Route A Worker] Processing Silent Retry for ${paymentId} (Attempt ${retryCount + 1}/3)`);

    // Inquest: Check if captured in background
    const isCaptured = await TriageService.verifyLateAuthorization(paymentId);

    if (isCaptured) {
      await RecoveryLedger.findOneAndUpdate(
        { paymentId },
        {
          status: 'RECOVERED',
          recoveredAmount: amount,
          $push: {
            auditTrail: {
              stage: 'INQUEST',
              action: 'Late Authorization Detected. Transaction auto-reconciled.',
              timestamp: new Date(),
            },
          },
        }
      );
      return { status: 'RECOVERED' };
    }

    if (retryCount + 1 >= 3) {
      // Sever recovery path after 3 attempts -> Route to DLQ
      await RecoveryLedger.findOneAndUpdate(
        { paymentId },
        {
          status: 'TERMINAL_DLQ',
          retryCount: 3,
          $push: {
            auditTrail: {
              stage: 'TERMINAL_REVIEW',
              action: 'Exhausted 3 silent retries. Shifted to Terminal DLQ.',
              timestamp: new Date(),
            },
          },
        }
      );
      return { status: 'TERMINAL_DLQ' };
    }

    // Schedule next backoff attempt (60s, 120s, 300s)
    const delays = [60000, 120000, 300000];
    const nextDelay = delays[retryCount] || 300000;

    await RecoveryLedger.findOneAndUpdate(
      { paymentId },
      {
        retryCount: retryCount + 1,
        status: 'SCHEDULED_RETRY',
        $push: {
          auditTrail: {
            stage: 'RETRY_SCHEDULED',
            action: `Scheduled retry #${retryCount + 2} in ${nextDelay / 1000}s`,
            timestamp: new Date(),
          },
        },
      }
    );

    await routeAQueue.add(
      'silent-retry-job',
      { paymentId, amount, retryCount: retryCount + 1 },
      { delay: nextDelay }
    );
  },
  { connection: redisConnection as any, concurrency: 5 }
);

/**
 * Worker for Route B: Agentic Dunning & 1-Click UPI Links
 */
export const routeBWorker = new Worker(
  'route-b-agentic-dunning',
  async (job: Job) => {
    const { paymentId, amount, errorReason, email, contact, isDebitedRisk } = job.data;
    console.log(`[Route B Worker] Executing Dunning Flow for ${paymentId}`);

    // Generate UPI Intent Link
    const linkUrl = await AiDunningService.createRecoveryPaymentLink(paymentId, amount, email, contact);

    // Generate Hinglish Outreach
    const message = await AiDunningService.generateRecoveryMessage(
      'Customer',
      amount,
      errorReason,
      linkUrl,
      isDebitedRisk
    );

    await RecoveryLedger.findOneAndUpdate(
      { paymentId },
      {
        status: 'DUNNING_SENT',
        paymentLinkUrl: linkUrl,
        $push: {
          auditTrail: {
            stage: 'AGENTIC_DUNNING',
            action: 'Dispatched 1-click UPI recovery nudge.',
            details: { linkUrl, messageSnippet: message.text.substring(0, 80) },
            timestamp: new Date(),
          },
        },
      }
    );

    return { status: 'DUNNING_SENT', linkUrl };
  },
  { connection: redisConnection as any, concurrency: 10 }
);