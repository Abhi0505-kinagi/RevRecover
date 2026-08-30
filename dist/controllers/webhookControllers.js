"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRazorpayWebhook = void 0;
const triageMatrix_1 = require("../services/triageMatrix");
const RecoveryLedger_1 = require("../models/RecoveryLedger");
const recoveryQueues_1 = require("../queues/recoveryQueues");
const Invoice_1 = require("../models/Invoice");
const handleRazorpayWebhook = async (req, res) => {
    try {
        const eventPayload = req.body;
        const payment = eventPayload.payload?.payment?.entity;
        if (!payment) {
            res.status(400).json({ error: 'Malformed webhook payload' });
            return;
        }
        // Auto-reconciliation check on captured events
        if (eventPayload.event === 'payment.captured' || eventPayload.event === 'order.paid') {
            const matchFilter = payment.order_id
                ? { $or: [{ paymentId: payment.id }, { orderId: payment.order_id, status: { $ne: 'RECOVERED' } }] }
                : { paymentId: payment.id };
            await RecoveryLedger_1.RecoveryLedger.updateMany(matchFilter, {
                status: 'RECOVERED',
                recoveredAmount: payment.amount,
                $push: {
                    auditTrail: {
                        stage: 'RECONCILIATION',
                        action: `Received ${eventPayload.event} for payment ${payment.id} (order ${payment.order_id || 'n/a'}). Marked as fully recovered.`,
                        timestamp: new Date(),
                    },
                },
            });
            const invoiceId = payment.notes?.invoiceId;
            if (invoiceId) {
                await Invoice_1.Invoice.findOneAndUpdate({ invoiceId }, { status: 'PAID' });
            }
            const originalPaymentId = payment.notes?.originalPaymentId;
            if (originalPaymentId) {
                await RecoveryLedger_1.RecoveryLedger.findOneAndUpdate(
                // { paymentId: originalPaymentId },
                { paymentId: originalPaymentId, status: { $ne: 'RECOVERED' } }, {
                    status: 'RECOVERED',
                    recoveredAmount: payment.amount,
                    $push: {
                        auditTrail: {
                            stage: 'RECOVERY_LINK_COMPLETED',
                            action: `Customer completed payment via recovery link (new payment ${payment.id}).`,
                            timestamp: new Date(),
                        },
                    },
                });
            }
            res.status(200).json({ status: 'reconciled' });
            return;
        }
        if (eventPayload.event === 'payment.failed') {
            const originalPaymentId = payment.notes?.originalPaymentId;
            if (originalPaymentId) {
                const existing = await RecoveryLedger_1.RecoveryLedger.findOne({ paymentId: originalPaymentId });
                if (existing && existing.status !== 'RECOVERED') {
                    res.status(200).json({ status: 'retry_failure_recorded', paymentId: existing.paymentId });
                    await RecoveryLedger_1.RecoveryLedger.updateOne({ _id: existing._id }, {
                        $set: { paymentId: payment.id, orderId: payment.order_id },
                        $push: {
                            auditTrail: {
                                stage: 'RETRY_ATTEMPT_FAILED',
                                action: `Retry via recovery link failed again (new payment ${payment.id}): ${payment.error_reason}`,
                                timestamp: new Date(),
                            },
                        },
                    });
                    return;
                }
            }
        }
        // Triage the failure
        const triage = triageMatrix_1.TriageService.diagnose(payment);
        // 1. Send immediate 200 OK acknowledgment to Razorpay (sub-10ms response time)
        res.status(200).json({ status: 'ingested', route: triage.route, paymentId: payment.id });
        const recoveryEnabled = process.env.RECOVERY_ACTIONS_ENABLED !== 'false';
        // 2. Execute MongoDB Atlas write and BullMQ queue push concurrently in the background
        Promise.all([
            RecoveryLedger_1.RecoveryLedger.create({
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
            recoveryEnabled && triage.route === 'ROUTE_A'
                ? recoveryQueues_1.routeAQueue.add('silent-retry-job', {
                    paymentId: payment.id,
                    amount: payment.amount,
                    retryCount: 0,
                })
                : recoveryEnabled && triage.route === 'ROUTE_B'
                    ? recoveryQueues_1.routeBQueue.add('agentic-dunning-job', {
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
    }
    catch (error) {
        console.error('Error handling webhook:', error);
        res.status(500).json({ error: error.message });
    }
};
exports.handleRazorpayWebhook = handleRazorpayWebhook;
