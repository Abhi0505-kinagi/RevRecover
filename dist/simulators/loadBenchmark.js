"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const API_BASE = 'http://localhost:5000/api';
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret';
// Benchmark Configuration
const TOTAL_REQUESTS = 1000;
const CONCURRENCY = 50;
const metrics = [];
// Realistic traffic distribution generator
function generateSyntheticPayload(index) {
    const paymentId = `pay_bench_${Date.now()}_${index}_${crypto_1.default.randomBytes(3).toString('hex')}`;
    const scenarios = [
        { route: 'ROUTE_A', code: 'GATEWAY_ERROR', source: 'gateway', reason: 'gateway_technical_error', step: 'payment_authorization', amount: 249900 },
        { route: 'ROUTE_B', code: 'BAD_REQUEST_ERROR', source: 'customer', reason: 'insufficient_funds', step: 'payment_authorization', amount: 149900 },
        { route: 'ROUTE_C', code: 'BAD_REQUEST_ERROR', source: 'issuer_bank', reason: 'card_expired', step: 'payment_authentication', amount: 500000 },
        { route: 'LATE_AUTH', event: 'payment.captured', amount: 399900, step: 'payment_capture' },
    ];
    const scenario = scenarios[index % scenarios.length];
    const isCaptured = scenario.route === 'LATE_AUTH';
    const payload = {
        entity: 'event',
        account_id: 'acc_benchmark',
        event: isCaptured ? 'payment.captured' : 'payment.failed',
        contains: ['payment'],
        payload: {
            payment: {
                entity: {
                    id: paymentId,
                    amount: scenario.amount,
                    currency: 'INR',
                    status: isCaptured ? 'captured' : 'failed',
                    error_code: scenario.code,
                    error_source: scenario.source,
                    error_reason: scenario.reason,
                    error_step: scenario.step,
                    email: `user_${index}@example.com`,
                    contact: `+9198765${(10000 + (index % 90000)).toString()}`,
                    created_at: Math.floor(Date.now() / 1000),
                },
            },
        },
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto_1.default.createHmac('sha256', SECRET).update(rawBody).digest('hex');
    return { payload, signature, route: scenario.route };
}
async function sendWorker(queue) {
    while (queue.length > 0) {
        const itemIndex = queue.shift();
        if (itemIndex === undefined)
            break;
        const { payload, signature, route } = generateSyntheticPayload(itemIndex);
        const start = performance.now();
        try {
            const res = await axios_1.default.post(`${API_BASE}/webhooks/razorpay`, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Razorpay-Signature': signature,
                },
                timeout: 10000,
            });
            const latencyMs = performance.now() - start;
            metrics.push({ latencyMs, statusCode: res.status, route });
        }
        catch (err) {
            const latencyMs = performance.now() - start;
            metrics.push({
                latencyMs,
                statusCode: err.response?.status || 500,
                route,
            });
        }
    }
}
function calculatePercentile(latencies, p) {
    if (latencies.length === 0)
        return 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return Number(sorted[Math.max(0, index)].toFixed(2));
}
async function runBenchmark() {
    console.log('\n================================================================');
    console.log('       AUTONOMOUS ENGINE - HIGH LOAD & ATLAS LATENCY BENCHMARK   ');
    console.log('================================================================');
    console.log(`Target:           ${API_BASE}/webhooks/razorpay`);
    console.log(`Total Requests:   ${TOTAL_REQUESTS}`);
    console.log(`Concurrency:      ${CONCURRENCY} workers`);
    console.log('Firing dynamic, cryptographically signed workloads...\n');
    const requestIndices = Array.from({ length: TOTAL_REQUESTS }, (_, i) => i);
    const overallStart = performance.now();
    // Spawn concurrent worker pool
    const workers = Array.from({ length: CONCURRENCY }, () => sendWorker(requestIndices));
    await Promise.all(workers);
    const totalTimeSec = (performance.now() - overallStart) / 1000;
    const latencies = metrics.map((m) => m.latencyMs);
    const successful = metrics.filter((m) => m.statusCode === 200).length;
    const failed = metrics.filter((m) => m.statusCode !== 200).length;
    const rps = (TOTAL_REQUESTS / totalTimeSec).toFixed(1);
    console.log('================================================================');
    console.log('                    THROUGHPUT & HTTP METRICS                   ');
    console.log('================================================================');
    console.log(`Completed in:     ${totalTimeSec.toFixed(2)}s`);
    console.log(`Throughput:       ${rps} req/sec`);
    console.log(`Successful (200): ${successful} / ${TOTAL_REQUESTS}`);
    console.log(`Failed / Dropped: ${failed}`);
    console.log('\n================================================================');
    console.log('                   LATENCY PERCENTILES (Atlas RTT)              ');
    console.log('================================================================');
    console.log(`Min Latency:      ${calculatePercentile(latencies, 0)} ms`);
    console.log(`p50 (Median):     ${calculatePercentile(latencies, 50)} ms`);
    console.log(`p90:              ${calculatePercentile(latencies, 90)} ms`);
    console.log(`p95:              ${calculatePercentile(latencies, 95)} ms`);
    console.log(`p99:              ${calculatePercentile(latencies, 99)} ms`);
    console.log(`Max Latency:      ${calculatePercentile(latencies, 100)} ms`);
    // Query updated Mongo Atlas Metrics
    try {
        const metricsRes = await axios_1.default.get(`${API_BASE}/metrics`);
        const kpis = metricsRes.data.financialKPIs || {};
        const rates = kpis.rates || {};
        console.log('\n================================================================');
        console.log('               ATLAS COHORT FINANCIAL TELEMETRY                ');
        console.log('================================================================');
        console.log(`Gross at Risk:    ₹${Number(kpis.grossRevenueAtRisk || 0).toLocaleString('en-IN')}`);
        console.log(`In-Flight Buffer: ₹${Number(kpis.inFlightWorkingCapital || 0).toLocaleString('en-IN')}`);
        console.log(`Net Recovered:    ₹${Number(kpis.totalRecovered || 0).toLocaleString('en-IN')}`);
        console.log(`AOR Conversion:   ${rates.netAddressableOpportunityRatePercentage || 0}%`);
        console.log('================================================================\n');
    }
    catch (err) {
        console.log('Could not fetch aggregate metrics:', err.message);
    }
}
runBenchmark();
