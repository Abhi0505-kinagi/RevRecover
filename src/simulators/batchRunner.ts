import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = 'http://localhost:5000/api/webhooks/razorpay';
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret';

const scenarios = [
  {
    name: '502 Gateway Timeout (Route A)',
    payload: {
      entity: 'event',
      account_id: 'acc_demo_01',
      event: 'payment.failed',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: `pay_502_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            amount: 249900,
            currency: 'INR',
            status: 'failed',
            error_code: 'GATEWAY_ERROR',
            error_source: 'gateway',
            error_reason: 'gateway_technical_error',
            error_step: 'payment_initiation',
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    },
  },
  {
    name: 'Subscription Low Balance (Route B)',
    payload: {
      entity: 'event',
      account_id: 'acc_demo_01',
      event: 'payment.failed',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: `pay_funds_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            amount: 149900,
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
    },
  },
  {
    name: 'Card Stolen / Risk Check Failed (Route C)',
    payload: {
      entity: 'event',
      account_id: 'acc_demo_01',
      event: 'payment.failed',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: `pay_fraud_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            amount: 500000,
            currency: 'INR',
            status: 'failed',
            error_code: 'BAD_REQUEST_ERROR',
            error_source: 'issuer_bank',
            error_reason: 'payment_risk_check_failed',
            error_step: 'payment_authentication',
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    },
  },
];

async function runBatch() {
  console.log('⚡ Starting Batch Simulation of 15 payment failure events...\n');

  let routeACount = 0;
  let routeBCount = 0;
  let routeCCount = 0;
  let totalAtRisk = 0;

  for (let i = 0; i < 15; i++) {
    const template = scenarios[i % scenarios.length];
    const payload = JSON.parse(JSON.stringify(template.payload));
    payload.payload.payment.entity.id = `pay_sim_${Date.now()}_${i}`;

    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');

    totalAtRisk += payload.payload.payment.entity.amount;

    try {
      const res = await axios.post(API_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
      });

      if (res.data.route === 'ROUTE_A') routeACount++;
      if (res.data.route === 'ROUTE_B') routeBCount++;
      if (res.data.route === 'ROUTE_C') routeCCount++;

      console.log(`[Event ${i + 1}/15] Ingested -> ${template.name} -> Assigned: ${res.data.route}`);
    } catch (err: any) {
      console.error(`Event ${i + 1} failed to post:`, err.message);
    }
  }

  console.log('\n============================================================');
  console.log('              BATCH SIMULATION SUMMARY                      ');
  console.log('============================================================');
  console.log(`Total Events Ingested:        15`);
  console.log(`Total Revenue at Risk:        ₹${(totalAtRisk / 100).toLocaleString()}`);
  console.log(`• Route A (Silent 5XX Queue): ${routeACount}`);
  console.log(`• Route B (Agentic Dunning):  ${routeBCount}`);
  console.log(`• Route C (Terminal DLQ):     ${routeCCount}`);
  console.log('============================================================\n');
}

runBatch();