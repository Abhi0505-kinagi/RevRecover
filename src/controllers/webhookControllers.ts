import { Request, Response } from 'express';
import { RazorpayWebhookPayload } from '../types/razorpay';
import { TriageService } from '../services/triageMatrix';
import { RecoveryLedger } from '../models/RecoveryLedger';
import { routeAQueue, routeBQueue } from '../queues/recoveryQueues';

export const handleRazorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const eventPayload = req.body as RazorpayWebhookPayload;
    const payment = eventPayload.payload?.payment?.entity;

    if (!payment) {
      res.status(400).json({ error: 'Malformed webhook payload' });
      return;
    }

    // Auto-reconciliation check on captured events
    if (eventPayload.event === 'payment.captured' || eventPayload.event === 'order.paid') {
      await RecoveryLedger.findOneAndUpdate(
        { paymentId: payment.id },
        {
          status: 'RECOVERED',
          recoveredAmount: payment.amount,
          $push: {
            auditTrail: {
              stage: 'RECONCILIATION',
              action: `Received ${eventPayload.event}. Payment marked as fully recovered.`,
              timestamp: new Date(),
            },
          },
        }
      );
      res.status(200).json({ status: 'reconciled' });
      return;
    }

    // Triage the failure
    const triage = TriageService.diagnose(payment);

    // 1. Send immediate 200 OK acknowledgment to Razorpay (sub-10ms response time)
    res.status(200).json({ status: 'ingested', route: triage.route, paymentId: payment.id });

    // 2. Execute MongoDB Atlas write and BullMQ queue push concurrently in the background
    Promise.all([
      RecoveryLedger.create({
        paymentId: payment.id,
        orderId: payment.order_id,
        invoiceId: payment.invoice_id,
        amount: payment.amount,
        currency: payment.currency,
        customerEmail: payment.email,
        customerContact: payment.contact,
        errorSource: payment.error_source,
        errorStep: payment.error_step,
        errorReason: payment.error_reason,
        errorCode: payment.error_code,
        assignedRoute: triage.route,
        status: triage.route === 'ROUTE_C' ? 'TERMINAL_DLQ' : 'PENDING',
        maxRetries: triage.maxRetries,
        isDebitedRisk: triage.isDebitedRisk,
        auditTrail: [
          {
            stage: 'INGESTION',
            action: `Webhook received: ${eventPayload.event}`,
            details: { error_reason: payment.error_reason, source: payment.error_source },
            timestamp: new Date(),
          },
          {
            stage: 'TRIAGE',
            action: `Assigned to ${triage.route}`,
            details: { suggestedAction: triage.suggestedAction },
            timestamp: new Date(),
          },
        ],
      }),
      triage.route === 'ROUTE_A'
        ? routeAQueue.add('silent-retry-job', {
            paymentId: payment.id,
            amount: payment.amount,
            retryCount: 0,
          })
        : triage.route === 'ROUTE_B'
        ? routeBQueue.add('agentic-dunning-job', {
            paymentId: payment.id,
            amount: payment.amount,
            errorReason: payment.error_reason,
            email: payment.email,
            contact: payment.contact,
            isDebitedRisk: triage.isDebitedRisk,
          })
        : Promise.resolve(null),
    ]).catch((err) => {
      console.error(`Async background persistence error for ${payment.id}:`, err.message);
    });
  } catch (error: any) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: error.message });
  }
};