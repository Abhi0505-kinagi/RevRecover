import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { RecoveryLedger } from '../models/RecoveryLedger';
import { AiDunningService } from '../services/aiDunning';
import { verifyLateAuthorization } from '../services/triageMatrix';
import { timeStamp } from 'node:console';
import { Invoice } from '../models/Invoice';
import { LegalNoticeService } from '../services/legalNoticeService';

const DEFAULT_QUEUE_CONFIG = {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 200,
    removeOnFail: 1000,
  },
};

export const routeAQueue = new Queue('route-a-silent-retries', DEFAULT_QUEUE_CONFIG);
export const routeBQueue = new Queue('route-b-agentic-dunning', DEFAULT_QUEUE_CONFIG);

export const routeAWorker = new Worker(
  'route-a-silent-retries',
  async (job: Job) => {
    const { paymentId, amount, retryCount = 0 } = job.data;

    // Guard: Check if payment already cleared via bank delayed capture
    const isCaptured = await verifyLateAuthorization(paymentId);
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

    // Terminal DLQ transition after 3 scheduled intervals
    const delays = [60000, 120000, 300000]; // 1m -> 2m -> 5m
    if(retryCount>=delays.length){
      await RecoveryLedger.findOneAndUpdate(
        {paymentId},{
          status:"TERMINAL_DLQ",
          retryCount,
          $push:{auditTrail:{stage:"TERMINAL_REVIEW",
            action:'Exhausted all 3 silent retries (1m, 2m, 5m). Moved to DLQ.',
            timestamp:new Date()
          }}
        }
      );
      return {status:'TERMINAL_DLQ'};
    }
    const nextDelay = delays[retryCount];
    

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

export const routeBWorker = new Worker(
  'route-b-agentic-dunning',
  async (job: Job) => {
    const { paymentId, amount, errorReason, email, contact, isDebitedRisk } = job.data;
    const isCaptured = await verifyLateAuthorization(paymentId);
    if(isCaptured){
      await RecoveryLedger.findOneAndUpdate(
        {paymentId},{
          status:"RECOVERED",
          recoveredAmount:amount,
          $push:{auditTrail:{
            stage:"INQUEST",
            action:'Payment already captured before dunning dispatch. Nudge suppressed.',
            timeStamp:new Date()
          }}
        }
      );
      return {status:'SUPPRESSED_ALREADY_PAID'};
    }
    const linkUrl = await AiDunningService.createRecoveryPaymentLink(paymentId, amount, email, contact);
    const dunningResult = await AiDunningService.generateRecoveryMessage(
      email?.split('@')[0] || 'Customer',
      amount,
      errorReason,
      linkUrl,
      isDebitedRisk,
      contact
    );

    await RecoveryLedger.findOneAndUpdate(
      { paymentId },
      {
        status: 'DUNNING_SENT',
        paymentLinkUrl: linkUrl,
        $push: {
          auditTrail: {
            stage: 'AGENTIC_DUNNING',
            action: `Dispatched ${dunningResult.templateId} via WhatsApp.`,
            details: {
              linkUrl,
              dispatchStatus: dunningResult.dispatchResult.status,
              messageId: dunningResult.dispatchResult.messageId,
              messagePreview: dunningResult.text.slice(0, 80),
            },
            timestamp: new Date(),
          },
        },
      }
    );

    return { status: 'DUNNING_SENT', linkUrl, templateId: dunningResult.templateId };
  },
  { connection: redisConnection as any, concurrency: 10 }
);
export const ptpWatchdogQueue = new Queue('ptp-watchdog-queue', DEFAULT_QUEUE_CONFIG);

export const ptpWatchdogWorker = new Worker(
  'ptp-watchdog-queue',
  async (job: Job) => {
    const { invoiceId } = job.data;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return { status: 'INVOICE_NOT_FOUND' };

    // Guard: If invoice is already paid, do nothing
    if (invoice.status === 'PAID') {
      return { status: 'ALREADY_PAID' };
    }

    // Check if PTP date has passed and payment is still unfulfilled
    const isPtpBreached =
      invoice.status === 'PROMISE_TO_PAY' &&
      invoice.ptpDate &&
      new Date() > new Date(invoice.ptpDate);

    if (isPtpBreached) {
      // 1. Transition state
      invoice.status = 'ESCALATED_LEGAL';
      await invoice.save();

      // 2. Dispatch Formal Legal Notice Email with Interest & Penalties
      const linkUrl = await AiDunningService.createRecoveryPaymentLink(
        invoice.invoiceId,
        invoice.amount,
        invoice.clientEmail,
        invoice.clientPhone
      );
      await LegalNoticeService.dispatchDemandNotice({
        invoiceNumber: invoice.invoiceId,
        clientCompanyName: invoice.clientName,
        clientEmail: invoice.clientEmail,
        originalDueDate: invoice.dueDate.toISOString().split('T')[0],
        breachedPtpDate: invoice.ptpDate?.toISOString().split('T')[0],
        principalAmount: invoice.amount,
        curePeriodDays: 7,
        paymentLink:linkUrl
      });

      return { status: 'ESCALATED_LEGAL_NOTICE_SENT', invoiceNumber: invoice.invoiceId };
    }

    return { status: 'PTP_STILL_ACTIVE' };
  },
  { connection: redisConnection as any, concurrency: 5 }
);