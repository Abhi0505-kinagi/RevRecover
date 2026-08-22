"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRazorpayWebhook = void 0;
const triageMatrix_1 = require("../services/triageMatrix");
const RecoveryLedger_1 = require("../models/RecoveryLedger");
const recoveryQueues_1 = require("../queues/recoveryQueues");
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
            await RecoveryLedger_1.RecoveryLedger.findOneAndUpdate({ paymentId: payment.id }, {
                status: 'RECOVERED',
                recoveredAmount: payment.amount,
                $push: {
                    auditTrail: {
                        stage: 'RECONCILIATION',
                        action: `Received ${eventPayload.event}. Payment marked as fully recovered.`,
                        timestamp: new Date(),
                    },
                },
            });
            res.status(200).json({ status: 'reconciled' });
            return;
        }
        // Triage the failure
        const triage = triageMatrix_1.TriageService.diagnose(payment);
        // Persist to MongoDB Ledger
        const ledger = await RecoveryLedger_1.RecoveryLedger.create({
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
        });
        // Route dispatching
        if (triage.route === 'ROUTE_A') {
            await recoveryQueues_1.routeAQueue.add('silent-retry-job', {
                paymentId: payment.id,
                amount: payment.amount,
                retryCount: 0,
            });
        }
        else if (triage.route === 'ROUTE_B') {
            await recoveryQueues_1.routeBQueue.add('agentic-dunning-job', {
                paymentId: payment.id,
                amount: payment.amount,
                errorReason: payment.error_reason,
                email: payment.email,
                contact: payment.contact,
                isDebitedRisk: triage.isDebitedRisk,
            });
        }
        res.status(200).json({ status: 'ingested', route: triage.route, ledgerId: ledger._id });
    }
    catch (error) {
        console.error('Error handling webhook:', error);
        res.status(500).json({ error: error.message });
    }
};
exports.handleRazorpayWebhook = handleRazorpayWebhook;
