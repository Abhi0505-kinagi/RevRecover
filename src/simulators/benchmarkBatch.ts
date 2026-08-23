import 'dotenv/config';

interface SimulationResult {
  totalCount: number;
  atRiskPaise: number;
  recoveredPaise: number;
  healedCount: number;
  suppressedCount: number;
  feesSavedPaise: number;
}

// 1. Failure vectors matching Indian payment gateway failure distributions
const B2C_ERROR_TYPES = [
  { code: 'GATEWAY_TIMEOUT', route: 'ROUTE_A', weight: 0.25, organicProb: 0.15, engineProb: 0.85, isDebitedRisk: true },
  { code: 'BANK_SERVER_DOWN', route: 'ROUTE_A', weight: 0.15, organicProb: 0.12, engineProb: 0.80, isDebitedRisk: false },
  { code: 'BAD_REQUEST_INSUFFICIENT_FUNDS', route: 'ROUTE_B', weight: 0.30, organicProb: 0.18, engineProb: 0.62, isDebitedRisk: false },
  { code: 'PAYMENT_CANCELLED_BY_USER', route: 'ROUTE_B', weight: 0.12, organicProb: 0.16, engineProb: 0.58, isDebitedRisk: false },
  { code: 'CARD_EXPIRED', route: 'ROUTE_C', weight: 0.10, organicProb: 0.00, engineProb: 0.00, isDebitedRisk: false },
  { code: 'SUSPECTED_FRAUD_BLOCK', route: 'ROUTE_C', weight: 0.08, organicProb: 0.00, engineProb: 0.00, isDebitedRisk: false },
];

function runBatchEvaluation() {
  console.log('================================================================');
  console.log('    EXECUTING BATCH BENCHMARK (1,000 B2C + 100 B2B CASES)       ');
  console.log('================================================================\n');

  let controlRecoveredPaise = 0;
  let engineRecoveredPaise = 0;
  let totalAtRiskPaise = 0;

  let routeA_Total = 0, routeA_ControlHealed = 0, routeA_EngineHealed = 0, routeA_InquestHealed = 0;
  let routeB_Total = 0, routeB_ControlHealed = 0, routeB_EngineHealed = 0;
  let routeC_Total = 0, routeC_Suppressed = 0;

  // --- A. SIMULATE 1,000 B2C TRANSACTIONS ---
  const B2C_BATCH_SIZE = 1000;
  for (let i = 0; i < B2C_BATCH_SIZE; i++) {
    // Randomized basket size between ₹500 and ₹10,000 (in paise)
    const amountPaise = Math.floor(50000 + Math.random() * 950000);
    totalAtRiskPaise += amountPaise;

    // Pick error distribution
    const rand = Math.random();
    let accumulated = 0;
    let selectedError = B2C_ERROR_TYPES[0];
    for (const err of B2C_ERROR_TYPES) {
      accumulated += err.weight;
      if (rand <= accumulated) {
        selectedError = err;
        break;
      }
    }

    // Control Group outcome (organic behavior only)
    const controlHealed = Math.random() < selectedError.organicProb;
    if (controlHealed) controlRecoveredPaise += amountPaise;

    // RevRecover Engine outcome
    if (selectedError.route === 'ROUTE_A') {
      routeA_Total++;
      if (controlHealed) routeA_ControlHealed++;

      // Inquest check catches 35% of Route A as late authorizations
      const isInquestLateCapture = selectedError.isDebitedRisk && Math.random() < 0.35;
      const engineSuccess = isInquestLateCapture || Math.random() < selectedError.engineProb;

      if (engineSuccess) {
        routeA_EngineHealed++;
        if (isInquestLateCapture) routeA_InquestHealed++;
        engineRecoveredPaise += amountPaise;
      }
    } else if (selectedError.route === 'ROUTE_B') {
      routeB_Total++;
      if (controlHealed) routeB_ControlHealed++;

      const engineSuccess = Math.random() < selectedError.engineProb;
      if (engineSuccess) {
        routeB_EngineHealed++;
        engineRecoveredPaise += amountPaise;
      }
    } else if (selectedError.route === 'ROUTE_C') {
      routeC_Total++;
      routeC_Suppressed++; // 100% stopped by triage rules
    }
  }

  // --- B. SIMULATE 100 B2B OVERDUE INVOICES ---
  const B2B_BATCH_SIZE = 100;
  let b2bTotalAtRiskPaise = 0;
  let b2bPtpSettled = 0;
  let b2bLegalCureSettled = 0;
  let b2bControlSettled = 0;

  for (let i = 0; i < B2B_BATCH_SIZE; i++) {
    const invoicePaise = Math.floor(2500000 + Math.random() * 5000000); // ₹25,000 - ₹75,000
    b2bTotalAtRiskPaise += invoicePaise;
    totalAtRiskPaise += invoicePaise;

    // Control: only 16% settle unprompted
    if (Math.random() < 0.16) {
      b2bControlSettled++;
      controlRecoveredPaise += invoicePaise;
    }

    // Engine: 48% settle on PTP date; 60% of breached settle in legal cure window
    const settlesOnPtp = Math.random() < 0.48;
    if (settlesOnPtp) {
      b2bPtpSettled++;
      engineRecoveredPaise += invoicePaise;
    } else {
      const settlesInCurePeriod = Math.random() < 0.60;
      if (settlesInCurePeriod) {
        b2bLegalCureSettled++;
        // Recovered with 18% p.a. interest + ₹1,000 late fee
        const interestPaise = Math.round(invoicePaise * (0.18 / 365) * 7);
        const totalDuePaise = invoicePaise + interestPaise + 100000;
        engineRecoveredPaise += totalDuePaise;
      }
    }
  }

  // --- FORMATTED OUTPUT ---
  const formatINR = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  console.log('------------------ SIMULATION RESULTS ------------------');
  console.log(`Total Batch Size:         1,100 transactions (1,000 B2C + 100 B2B)`);
  console.log(`Total Gross GMV at Risk:  ${formatINR(totalAtRiskPaise)}`);
  console.log(`Control Group Recovered:  ${formatINR(controlRecoveredPaise)} (${((controlRecoveredPaise / totalAtRiskPaise) * 100).toFixed(2)}%)`);
  console.log(`RevRecover Net Recovered: ${formatINR(engineRecoveredPaise)} (${((engineRecoveredPaise / totalAtRiskPaise) * 100).toFixed(2)}%)`);
  console.log(`Net Incremental Lift:     +${formatINR(engineRecoveredPaise - controlRecoveredPaise)} (+${(((engineRecoveredPaise - controlRecoveredPaise) / totalAtRiskPaise) * 100).toFixed(2)}%)\n`);

  console.log('--- PIPELINE METRIC BREAKDOWN ---');
  console.log(`Route A (Silent Retries): ${routeA_EngineHealed}/${routeA_Total} recovered (${((routeA_EngineHealed / routeA_Total) * 100).toFixed(1)}%) | Inquest Self-Healed: ${routeA_InquestHealed}`);
  console.log(`Route B (WhatsApp UPI):   ${routeB_EngineHealed}/${routeB_Total} recovered (${((routeB_EngineHealed / routeB_Total) * 100).toFixed(1)}%)`);
  console.log(`Route C (Terminal Stop):  ${routeC_Suppressed}/${routeC_Total} retries suppressed (100% compliant)`);
  console.log(`B2B PTP & Legal Notice:   ${b2bPtpSettled + b2bLegalCureSettled}/${B2B_BATCH_SIZE} invoices cleared (${b2bPtpSettled} PTP, ${b2bLegalCureSettled} Legal Notice)\n`);
  console.log('========================================================');
}

runBatchEvaluation();