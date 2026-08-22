"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeBWorker = exports.routeAWorker = exports.routeBQueue = exports.routeAQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const RecoveryLedger_1 = require("../models/RecoveryLedger");
const aiDunning_1 = require("../services/aiDunning");
const triageMatrix_1 = require("../services/triageMatrix");
// Define BullMQ Queues
exports.routeAQueue = new bullmq_1.Queue('route-a-silent-retries', { connection: redis_1.redisConnection });
exports.routeBQueue = new bullmq_1.Queue('route-b-agentic-dunning', { connection: redis_1.redisConnection });
/**
 * Worker for Route A: Silent 1m -> 2m -> 5m 5XX Retries
 */
exports.routeAWorker = new bullmq_1.Worker('route-a-silent-retries', async (job) => {
    const { paymentId, amount, retryCount } = job.data;
    console.log(`[Route A Worker] Processing Silent Retry for ${paymentId} (Attempt ${retryCount + 1}/3)`);
    // Inquest: Check if captured in background
    const isCaptured = await triageMatrix_1.TriageService.verifyLateAuthorization(paymentId);
    if (isCaptured) {
        await RecoveryLedger_1.RecoveryLedger.findOneAndUpdate({ paymentId }, {
            status: 'RECOVERED',
            recoveredAmount: amount,
            $push: {
                auditTrail: {
                    stage: 'INQUEST',
                    action: 'Late Authorization Detected. Transaction auto-reconciled.',
                    timestamp: new Date(),
                },
            },
        });
        return { status: 'RECOVERED' };
    }
    if (retryCount + 1 >= 3) {
        // Sever recovery path after 3 attempts -> Route to DLQ
        await RecoveryLedger_1.RecoveryLedger.findOneAndUpdate({ paymentId }, {
            status: 'TERMINAL_DLQ',
            retryCount: 3,
            $push: {
                auditTrail: {
                    stage: 'TERMINAL_REVIEW',
                    action: 'Exhausted 3 silent retries. Shifted to Terminal DLQ.',
                    timestamp: new Date(),
                },
            },
        });
        return { status: 'TERMINAL_DLQ' };
    }
    // Schedule next backoff attempt (60s, 120s, 300s)
    const delays = [60000, 120000, 300000];
    const nextDelay = delays[retryCount] || 300000;
    await RecoveryLedger_1.RecoveryLedger.findOneAndUpdate({ paymentId }, {
        retryCount: retryCount + 1,
        status: 'SCHEDULED_RETRY',
        $push: {
            auditTrail: {
                stage: 'RETRY_SCHEDULED',
                action: `Scheduled retry #${retryCount + 2} in ${nextDelay / 1000}s`,
                timestamp: new Date(),
            },
        },
    });
    await exports.routeAQueue.add('silent-retry-job', { paymentId, amount, retryCount: retryCount + 1 }, { delay: nextDelay });
}, { connection: redis_1.redisConnection, concurrency: 5 });
/**
 * Worker for Route B: Agentic Dunning & 1-Click UPI Links
 */
exports.routeBWorker = new bullmq_1.Worker('route-b-agentic-dunning', async (job) => {
    const { paymentId, amount, errorReason, email, contact, isDebitedRisk } = job.data;
    console.log(`[Route B Worker] Executing Dunning Flow for ${paymentId}`);
    // Generate UPI Intent Link
    const linkUrl = await aiDunning_1.AiDunningService.createRecoveryPaymentLink(paymentId, amount, email, contact);
    // Generate Hinglish Outreach
    const message = await aiDunning_1.AiDunningService.generateRecoveryMessage('Customer', amount, errorReason, linkUrl, isDebitedRisk);
    await RecoveryLedger_1.RecoveryLedger.findOneAndUpdate({ paymentId }, {
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
    });
    return { status: 'DUNNING_SENT', linkUrl };
}, { connection: redis_1.redisConnection, concurrency: 10 });
