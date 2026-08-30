"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * REQUIRES (see accompanying implementation notes):
 *   1. webhookController.ts reconciles Invoice.status = 'PAID' via payment.notes.invoiceId
 *   2. webhookController.ts respects RECOVERY_ACTIONS_ENABLED=false to skip enqueueing
 *   3. (optional) recoveryQueues.ts BENCHMARK_FAST_RETRY override for Route A delays
 *
 * WHAT THIS SCRIPT SIMULATES vs WHAT IT MEASURES:
 *   - It simulates the ENVIRONMENT: which failures occur, and — for a documented
 *     fraction of them — whether the bank later captures the payment late, or
 *     whether the customer completes payment via the recovery link. These are
 *     assumptions about the world, stated explicitly below, not assumptions
 *     about whether YOUR engine works.
 *   - It MEASURES the engine: every RECOVERED / TERMINAL_DLQ / PAID / ESCALATED_LEGAL
 *     outcome comes from reading real documents your server wrote, after your
 *     real triage, queues, and workers processed real webhook calls.
 *
 * ASSUMPTIONS — state these in your write-up, don't hide them:
 *   - LATE_AUTH_RATE: fraction of "debited risk" B2C failures where the bank
 *     settles late (you are standing in for the bank here, since you have no
 *     access to real issuing-bank timing in a hackathon sandbox).
 *   - LINK_COMPLETION_RATE: fraction of Route B dunning recipients / B2B PTP
 *     invoices where the customer actually completes payment via the recovery
 *     link (you are standing in for the customer's decision).
 *   - These two numbers are NOT measured — they are inputs you chose. Say so.
 *     If you can find real published figures for Indian payment recovery link
 *     click-through/completion rates, cite them instead of guessing.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/revrecover';
const RUN_LABEL = (process.env.RUN_LABEL || 'engine');
const B2C_BATCH_SIZE = Number(process.env.B2C_BATCH_SIZE || 100);
const B2B_BATCH_SIZE = Number(process.env.B2B_BATCH_SIZE || 20);
// Stated assumptions — change these and say you changed them.
const LATE_AUTH_RATE = Number(process.env.LATE_AUTH_RATE ?? 0.25);
const LINK_COMPLETION_RATE = Number(process.env.LINK_COMPLETION_RATE ?? 0.40);
const B2B_PTP_REPLY_RATE = Number(process.env.B2B_PTP_REPLY_RATE ?? 0.55);
const B2B_PTP_HONOUR_RATE = Number(process.env.B2B_PTP_HONOUR_RATE ?? 0.60);
// Poll instead of guessing a sleep duration. Route A can legitimately take up
// to 8 minutes (1m+2m+5m) if BENCHMARK_FAST_RETRY isn't set on the server.
const POLL_INTERVAL_MS = 3000;
const B2C_MAX_WAIT_MS = Number(process.env.B2C_MAX_WAIT_MS || 9 * 60 * 1000);
const B2B_MAX_WAIT_MS = Number(process.env.B2B_MAX_WAIT_MS || 60 * 1000);
const B2C_ERROR_TYPES = [
    { code: 'GATEWAY_TIMEOUT', source: 'gateway', reason: 'gateway_technical_error', step: 'payment_authorization', weight: 0.25, debitedRisk: true },
    { code: 'BANK_SERVER_DOWN', source: 'gateway', reason: 'bank_technical_error', step: 'payment_authorization', weight: 0.15, debitedRisk: true },
    { code: 'BAD_REQUEST_INSUFFICIENT_FUNDS', source: 'customer', reason: 'insufficient_funds', step: 'payment_authorization', weight: 0.30, debitedRisk: false },
    { code: 'PAYMENT_CANCELLED_BY_USER', source: 'customer', reason: 'user_cancelled', step: 'payment_authorization', weight: 0.12, debitedRisk: false },
    { code: 'CARD_EXPIRED', source: 'issuer_bank', reason: 'card_expired', step: 'payment_authentication', weight: 0.10, debitedRisk: false },
    { code: 'SUSPECTED_FRAUD_BLOCK', source: 'issuer_bank', reason: 'payment_risk_check_failed', step: 'payment_authentication', weight: 0.08, debitedRisk: false },
];
function pickWeighted() {
    const rand = Math.random();
    let acc = 0;
    for (const e of B2C_ERROR_TYPES) {
        acc += e.weight;
        if (rand <= acc)
            return e;
    }
    return B2C_ERROR_TYPES[B2C_ERROR_TYPES.length - 1];
}
function sign(payload) {
    return crypto_1.default.createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex');
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function postWebhook(payload) {
    return axios_1.default.post(`${API_BASE}/webhooks/razorpay`, payload, {
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sign(payload) },
    });
}
async function injectB2CFailure(index) {
    const err = pickWeighted();
    const amountPaise = Math.floor(50000 + Math.random() * 950000);
    const paymentId = `pay_bench_${RUN_LABEL}_${Date.now()}_${index}_${crypto_1.default.randomBytes(3).toString('hex')}`;
    const failPayload = {
        entity: 'event', account_id: 'acc_benchmark', event: 'payment.failed', contains: ['payment'],
        payload: { payment: { entity: {
                    id: paymentId, amount: amountPaise, currency: 'INR', status: 'failed',
                    error_code: err.code, error_source: err.source, error_reason: err.reason, error_step: err.step,
                    created_at: Math.floor(Date.now() / 1000),
                } } },
    };
    const result = {
        paymentId, amountPaise, debitedRisk: err.debitedRisk,
        lateAuthScheduled: err.debitedRisk && Math.random() < LATE_AUTH_RATE,
        linkCompletionScheduled: !err.debitedRisk && err.code !== 'CARD_EXPIRED' && err.code !== 'SUSPECTED_FRAUD_BLOCK'
            && Math.random() < LINK_COMPLETION_RATE,
    };
    try {
        const res = await postWebhook(failPayload);
        result.route = res.data.route;
    }
    catch (e) {
        console.error(`  [B2C ${index}] initial webhook failed:`, e.message);
    }
    return result;
}
// Simulates the BANK settling late, or the CUSTOMER completing the recovery
// link — real external events your engine has to react to correctly, not a
// shortcut around your engine's own logic.
async function fireFollowUpCapture(paymentId, amountPaise) {
    const capturedPayload = {
        entity: 'event', account_id: 'acc_benchmark', event: 'payment.captured', contains: ['payment'],
        payload: { payment: { entity: {
                    id: paymentId, amount: amountPaise, currency: 'INR', status: 'captured',
                    created_at: Math.floor(Date.now() / 1000),
                } } },
    };
    try {
        await postWebhook(capturedPayload);
    }
    catch (e) {
        console.error(`  follow-up capture for ${paymentId} failed:`, e.message);
    }
}
async function injectB2BInvoice(index) {
    const invoicePaise = Math.floor(2500000 + Math.random() * 5000000);
    const invoiceId = `INV_BENCH_${RUN_LABEL}_${Date.now()}_${index}`;
    const dueDate = new Date(Date.now() - (5 + Math.floor(Math.random() * 15)) * 24 * 60 * 60 * 1000);
    const inv = {
        invoiceId, amountPaise: invoicePaise,
        ptpReplyScheduled: Math.random() < B2B_PTP_REPLY_RATE,
        ptpHonoured: Math.random() < B2B_PTP_HONOUR_RATE,
    };
    try {
        await axios_1.default.post(`${API_BASE}/invoices/create`, {
            invoiceId, clientName: `Benchmark Client ${index}`,
            clientEmail: `bench_${index}@example.com`, clientPhone: '+919876543210',
            amount: invoicePaise, dueDate: dueDate.toISOString(),
        });
    }
    catch (e) {
        console.error(`  [B2B ${index}] invoice create failed:`, e.message);
    }
    return inv;
}
// Real call to your real PTP parser — this is engine behavior, not simulated.
async function sendPtpReply(inv) {
    const dateStr = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    try {
        await axios_1.default.post(`${API_BASE}/invoices/negotiate-ptp`, {
            invoiceId: inv.invoiceId,
            message: `We will clear this on ${dateStr}, confirming the commitment.`,
        });
    }
    catch (e) {
        console.error(`  PTP reply for ${inv.invoiceId} failed:`, e.message);
    }
}
// Only meaningful once webhookController reconciles Invoice via notes.invoiceId (Change 1).
async function firePaymentLinkCompletion(invoiceId, amountPaise) {
    const payload = {
        entity: 'event', account_id: 'acc_benchmark', event: 'payment.captured', contains: ['payment'],
        payload: { payment: { entity: {
                    id: `pay_inv_${invoiceId}`, amount: amountPaise, currency: 'INR', status: 'captured',
                    notes: { invoiceId }, created_at: Math.floor(Date.now() / 1000),
                } } },
    };
    try {
        await postWebhook(payload);
    }
    catch (e) {
        console.error(`  invoice completion for ${invoiceId} failed:`, e.message);
    }
}
async function pollUntilTerminal(fetchFn, maxWaitMs) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        if (await fetchFn())
            return true;
        await sleep(POLL_INTERVAL_MS);
    }
    return false;
}
function formatINR(paise) {
    return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
async function run() {
    console.log('================================================================');
    console.log(`   REAL-MEASUREMENT BENCHMARK — run label: "${RUN_LABEL}"`);
    console.log('================================================================');
    console.log(`RECOVERY_ACTIONS_ENABLED must be set to ${RUN_LABEL === 'control' ? "'false'" : "'true' (default)"} on the SERVER for this run to mean what its label says.\n`);
    console.log(`Assumptions this run uses (NOT measured — say so in your report):`);
    console.log(`  LATE_AUTH_RATE=${LATE_AUTH_RATE}  LINK_COMPLETION_RATE=${LINK_COMPLETION_RATE}`);
    console.log(`  B2B_PTP_REPLY_RATE=${B2B_PTP_REPLY_RATE}  B2B_PTP_HONOUR_RATE=${B2B_PTP_HONOUR_RATE}\n`);
    await mongoose_1.default.connect(MONGO_URI);
    const RecoveryLedger = mongoose_1.default.connection.collection('recoveryledgers');
    const Invoice = mongoose_1.default.connection.collection('invoices');
    // ---------- B2C ----------
    console.log(`Injecting ${B2C_BATCH_SIZE} B2C failures...`);
    const b2cCases = [];
    for (let i = 0; i < B2C_BATCH_SIZE; i++) {
        b2cCases.push(await injectB2CFailure(i));
        await sleep(30);
    }
    // Fire environment follow-ups only for the cases we pre-selected to have them.
    for (const c of b2cCases) {
        if (c.lateAuthScheduled) {
            await sleep(500); // small realistic delay before "bank" confirms
            await fireFollowUpCapture(c.paymentId, c.amountPaise);
        }
        else if (c.linkCompletionScheduled) {
            await sleep(500); // stand-in for "customer clicked the link"
            await fireFollowUpCapture(c.paymentId, c.amountPaise);
        }
    }
    // ---------- B2B ----------
    console.log(`Injecting ${B2B_BATCH_SIZE} B2B invoices...`);
    const b2bInvoices = [];
    for (let i = 0; i < B2B_BATCH_SIZE; i++) {
        b2bInvoices.push(await injectB2BInvoice(i));
        await sleep(30);
    }
    for (const inv of b2bInvoices) {
        if (inv.ptpReplyScheduled) {
            await sendPtpReply(inv); // real call to your real PTP parser
            if (inv.ptpHonoured) {
                await firePaymentLinkCompletion(inv.invoiceId, inv.amountPaise);
            }
            // If not honoured: leave it. Reconciliation to ESCALATED_LEGAL/PTP_BROKEN
            // depends on Change 4 (auto-scheduled watchdog) or a manual call below.
        }
    }
    console.log('\nPolling real DB for terminal states (this can take up to the Route A retry ladder length)...');
    const b2cTerminal = new Map();
    await pollUntilTerminal(async () => {
        let allDone = true;
        for (const c of b2cCases) {
            if (b2cTerminal.has(c.paymentId))
                continue;
            const doc = await RecoveryLedger.findOne({ paymentId: c.paymentId });
            if (doc && (doc.status === 'RECOVERED' || doc.status === 'TERMINAL_DLQ' || doc.status === 'DUNNING_SENT')) {
                b2cTerminal.set(c.paymentId, doc);
            }
            else {
                allDone = false;
            }
        }
        return allDone;
    }, B2C_MAX_WAIT_MS);
    // Give broken B2B promises a chance to reconcile via the existing endpoint
    // (sidesteps Change 4 — uses what's already wired up today).
    try {
        await axios_1.default.post(`${API_BASE}/invoices/check-broken`);
    }
    catch (e) {
        console.error('check-broken call failed (confirm the real route path in invoiceRoutes.ts):', e.message);
    }
    await sleep(2000);
    const b2bTerminal = new Map();
    for (const inv of b2bInvoices) {
        const doc = await Invoice.findOne({ invoiceId: inv.invoiceId });
        if (doc)
            b2bTerminal.set(inv.invoiceId, doc);
    }
    // ---------- Aggregate REAL outcomes ----------
    let recoveredPaise = 0, recoveredCount = 0, terminalDlqCount = 0, stillPendingCount = 0;
    const byRoute = {};
    for (const c of b2cCases) {
        const doc = b2cTerminal.get(c.paymentId);
        const route = c.route || 'UNKNOWN';
        byRoute[route] = byRoute[route] || { total: 0, recovered: 0 };
        byRoute[route].total++;
        if (!doc) {
            stillPendingCount++;
            continue;
        }
        if (doc.status === 'RECOVERED') {
            recoveredCount++;
            recoveredPaise += doc.recoveredAmount || 0;
            byRoute[route].recovered++;
        }
        else if (doc.status === 'TERMINAL_DLQ') {
            terminalDlqCount++;
        }
    }
    let b2bPaidCount = 0, b2bPaidPaise = 0, b2bEscalatedCount = 0, b2bBrokenCount = 0, b2bOtherCount = 0;
    for (const inv of b2bInvoices) {
        const doc = b2bTerminal.get(inv.invoiceId);
        if (!doc) {
            b2bOtherCount++;
            continue;
        }
        if (doc.status === 'PAID') {
            b2bPaidCount++;
            b2bPaidPaise += inv.amountPaise;
        }
        else if (doc.status === 'ESCALATED_LEGAL')
            b2bEscalatedCount++;
        else if (doc.status === 'PTP_BROKEN')
            b2bBrokenCount++;
        else
            b2bOtherCount++;
    }
    const totalAtRiskPaise = b2cCases.reduce((s, c) => s + c.amountPaise, 0) + b2bInvoices.reduce((s, i) => s + i.amountPaise, 0);
    const totalRecoveredPaise = recoveredPaise + b2bPaidPaise;
    console.log('\n------------------ MEASURED RESULTS (real DB state, run: ' + RUN_LABEL + ') ------------------');
    console.log(`Total Gross at Risk:  ${formatINR(totalAtRiskPaise)}`);
    console.log(`Total Recovered:      ${formatINR(totalRecoveredPaise)} (${((totalRecoveredPaise / totalAtRiskPaise) * 100).toFixed(2)}%)\n`);
    console.log('--- B2C by route ---');
    for (const [route, s] of Object.entries(byRoute))
        console.log(`${route}: ${s.recovered}/${s.total} recovered`);
    console.log(`Terminal DLQ: ${terminalDlqCount}   Still pending at read time: ${stillPendingCount}`);
    console.log('\n--- B2B ---');
    console.log(`Paid: ${b2bPaidCount}   Escalated legal: ${b2bEscalatedCount}   PTP broken (unescalated): ${b2bBrokenCount}   Other/overdue: ${b2bOtherCount}`);
    console.log('\nSave this whole block, plus the assumptions printed above, in your report as-is.');
    console.log('If you also ran RUN_LABEL=control, diff the two "Total Recovered" lines by hand — that diff is your real lift.\n');
    await mongoose_1.default.disconnect();
}
run().catch((err) => {
    console.error('Benchmark run failed:', err);
    process.exit(1);
});
