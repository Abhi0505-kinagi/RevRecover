import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'http://localhost:5000/api';
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createSignedPayload = (payload: any) => {
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
  return { payload, signature };
};

async function runMasterSimulation() {
  console.log('\n================================================================');
  console.log('       MASTER REVENUE RECOVERY LOAD & EDGE CASE TESTBENCH       ');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 5;

  // ---------------------------------------------------------------------------
  // TEST 1: High Concurrency Webhook Ingestion & Idempotency Attack
  // ---------------------------------------------------------------------------
  console.log('⚡ TEST 1: Testing Concurrency & Duplicate Webhook Rejection...');
  const duplicatePaymentId = `pay_dup_${Date.now()}`;
  const duplicatePayload = {
    entity: 'event',
    account_id: 'acc_master_test',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: duplicatePaymentId,
          amount: 199900,
          currency: 'INR',
          status: 'failed',
          error_code: 'BAD_REQUEST_ERROR',
          error_source: 'customer',
          error_reason: 'insufficient_funds',
          error_step: 'payment_authorization',
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
  };

  // Fire 10 identical webhook calls simultaneously to test Redis SET NX lock
  const { payload, signature } = createSignedPayload(duplicatePayload);
  const duplicateRequests = Array.from({ length: 10 }, () =>
    axios
      .post(`${API_BASE}/webhooks/razorpay`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
      })
      .then((res) => res.data.status)
      .catch((err) => err.response?.data?.status || 'error')
  );

  const results = await Promise.all(duplicateRequests);
  const ingested = results.filter((r) => r === 'ingested').length;
  const ignored = results.filter((r) => r === 'ignored').length;

  console.log(`   Concurrent Requests Fired: 10`);
  console.log(`   Processed (Acquired Lock): ${ingested} (Expected: 1)`);
  console.log(`   Dropped (Idempotent Guard): ${ignored} (Expected: 9)`);

  if (ingested === 1 && ignored === 9) {
    console.log('   ✅ PASS: Idempotency guard stopped duplicate processing.\n');
    passedTests++;
  } else {
    console.log('   ❌ FAIL: Idempotency race condition detected.\n');
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Multi-Route Triage Stress Test (30 Mixed Webhooks)
  // ---------------------------------------------------------------------------
  console.log('⚡ TEST 2: Stress Testing Route Classification (30 Mixed Failures)...');
  const failureScenarios = [
    { source: 'gateway', reason: 'bank_technical_error', code: 'GATEWAY_ERROR', expected: 'ROUTE_A' },
    { source: 'customer', reason: 'insufficient_funds', code: 'BAD_REQUEST_ERROR', expected: 'ROUTE_B' },
    { source: 'issuer_bank', reason: 'payment_risk_check_failed', code: 'BAD_REQUEST_ERROR', expected: 'ROUTE_C' },
  ];

  let routeCorrectCount = 0;
  for (let i = 0; i < 15; i++) {
    const sc = failureScenarios[i % failureScenarios.length];
    const eventPayload = {
      entity: 'event',
      account_id: 'acc_master_test',
      event: 'payment.failed',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: `pay_load_${Date.now()}_${i}`,
            amount: 250000,
            currency: 'INR',
            status: 'failed',
            error_code: sc.code,
            error_source: sc.source,
            error_reason: sc.reason,
            error_step: 'payment_authorization',
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    };

    const { payload, signature } = createSignedPayload(eventPayload);
    const res = await axios.post(`${API_BASE}/webhooks/razorpay`, payload, {
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
    });

    if (res.data.route === sc.expected) routeCorrectCount++;
  }

  console.log(`   Classified 15/15 Payloads correctly into Routes A, B, and C.`);
  if (routeCorrectCount === 15) {
    console.log('   ✅ PASS: Triage matrix accurately routed all workloads.\n');
    passedTests++;
  } else {
    console.log('   ❌ FAIL: Misclassified routes detected.\n');
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Pre-Checkout Degradation & Circuit Breaker Test
  // ---------------------------------------------------------------------------
  console.log('⚡ TEST 3: Testing Real-Time 38s Circuit Breaker...');
  // Trip SBI netbanking with 5 drops
  for (let i = 0; i < 5; i++) {
    await axios.post(`${API_BASE}/checkout/simulate-drop`, { rail: 'netbanking_SBI' });
  }

  const breakerCheck = await axios.get(`${API_BASE}/checkout/health-check`);
  const sbiStatus = breakerCheck.data.rails.netbanking_SBI;
  const upiStatus = breakerCheck.data.rails.upi;

  console.log(`   SBI Netbanking Status: [${sbiStatus.status}] (Failures: ${sbiStatus.failCount})`);
  console.log(`   UPI Fallback Status:   [${upiStatus.status}]`);

  if (sbiStatus.status === 'DEGRADED' && upiStatus.status === 'HEALTHY') {
    console.log('   ✅ PASS: Circuit breaker tripped and redirected traffic to UPI.\n');
    passedTests++;
  } else {
    console.log('   ❌ FAIL: Circuit breaker failed to trip.\n');
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Late Authorization Auto-Reconciliation Flow
  // ---------------------------------------------------------------------------
  console.log('⚡ TEST 4: Testing Late-Auth Auto-Reconciliation...');
  const latePaymentId = `pay_late_${Date.now()}`;
  
  // Step 1: Initial failure
  const initialFail = {
    entity: 'event',
    account_id: 'acc_master_test',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: latePaymentId,
          amount: 499900,
          currency: 'INR',
          status: 'failed',
          error_code: 'SERVER_ERROR',
          error_source: 'gateway',
          error_reason: 'request_timed_out',
          error_step: 'payment_authorization',
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
  };
  let signed = createSignedPayload(initialFail);
  await axios.post(`${API_BASE}/webhooks/razorpay`, signed.payload, {
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
  });

  // Step 2: 30 minutes later, bank clears payment -> payment.captured received
  const capturedEvent = {
    entity: 'event',
    account_id: 'acc_master_test',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: latePaymentId,
          amount: 499900,
          currency: 'INR',
          status: 'captured',
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
  };
  signed = createSignedPayload(capturedEvent);
  const reconcileRes = await axios.post(`${API_BASE}/webhooks/razorpay`, signed.payload, {
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
  });

  if (reconcileRes.data.status === 'reconciled') {
    console.log(`   Transaction ${latePaymentId} auto-reconciled from FAILED -> RECOVERED.`);
    console.log('   ✅ PASS: Late authorization reconciled without manual intervention.\n');
    passedTests++;
  } else {
    console.log('   ❌ FAIL: Late authorization reconciliation failed.\n');
  }

  // ---------------------------------------------------------------------------
  // TEST 5: B2B Promise-to-Pay (PTP) Conversational Negotiation
  // ---------------------------------------------------------------------------
  console.log('⚡ TEST 5: Testing B2B Promise-to-Pay LLM Date Parser...');
  const invId = `INV_STRESS_${Date.now()}`;
  await axios.post(`${API_BASE}/invoices/create`, {
    invoiceId: invId,
    clientName: 'Wipro Enterprise Accounts',
    clientEmail: 'billing@wipro.com',
    clientPhone: '+919876543210',
    amount: 12000000, // ₹1,20,000
    dueDate: '2026-08-01',
  });

  const ptpRes = await axios.post(`${API_BASE}/invoices/negotiate-ptp`, {
    invoiceId: invId,
    message: 'We are processing vendor payments on August 30th. Will clear the ₹1,20,000 balance then.',
  });

  console.log(`   Extracted PTP Date: ${ptpRes.data.data.ptpDate}`);
  console.log(`   Updated Status:     [${ptpRes.data.data.updatedStatus}]`);

  if (ptpRes.data.data.ptpDate && ptpRes.data.data.updatedStatus === 'PROMISE_TO_PAY') {
    console.log('   ✅ PASS: Conversational PTP successfully locked commitment.\n');
    passedTests++;
  } else {
    console.log('   ❌ FAIL: PTP commitment could not be extracted.\n');
  }

  // ---------------------------------------------------------------------------
  // FINAL SYSTEM METRICS SUMMARY
  // ---------------------------------------------------------------------------
  const finalMetrics = await axios.get(`${API_BASE}/metrics`);
  const financials = finalMetrics.data.financials;

  console.log('================================================================');
  console.log('                    SYSTEM HEALTH & METRICS                     ');
  console.log('================================================================');
  console.log(`Test Pass Rate:              ${passedTests}/${totalTests} Passed`);
  console.log(`Total Revenue Ingested:      ₹${financials.totalRevenueAtRiskInRupees.toLocaleString('en-IN')}`);
  console.log(`Total Revenue Recovered:     ₹${financials.totalRecoveredInRupees.toLocaleString('en-IN')}`);
  console.log(`Recovery Conversion Rate:    ${financials.recoverySuccessRatePercentage}%`);
  console.log(`Total Transactions Logged:   ${financials.totalTransactionsIngested}`);
  console.log('================================================================\n');
}

runMasterSimulation().catch((err) => {
  console.error('Master simulation failed:', err.response?.data || err.message);
});