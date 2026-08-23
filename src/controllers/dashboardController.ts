import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { RecoveryLedger } from '../models/RecoveryLedger';
import { Invoice } from '../models/Invoice';

// 1. Direct In-App Seeder (Runs inside the exact same active MongoDB connection)
export async function handleSeedData(req: Request, res: Response) {
  try {
    await RecoveryLedger.deleteMany({});
    await Invoice.deleteMany({});

    await RecoveryLedger.insertMany([
      {
        paymentId: 'pay_OXYZ10928374',
        amount: 450000,
        recoveredAmount: 450000,
        status: 'RECOVERED',
        assignedRoute: 'ROUTE_A',
        errorCode: 'GATEWAY_TIMEOUT',
        isDebitedRisk: true,
        auditTrail: [
          { stage: 'INGRESS', action: 'HMAC verified, deduplication lock acquired' },
          { stage: 'INQUEST', action: 'Late Authorization Detected. Auto-healed with zero dunning.' },
        ],
      },
      {
        paymentId: 'pay_OXYZ88219482',
        amount: 249900,
        recoveredAmount: 249900,
        status: 'RECOVERED',
        assignedRoute: 'ROUTE_B',
        errorCode: 'BAD_REQUEST_INSUFFICIENT_FUNDS',
        isDebitedRisk: false,
        auditTrail: [
          { stage: 'INGRESS', action: 'Triaged to Route B' },
          { stage: 'DUNNING', action: 'WhatsApp 1-Click UPI Intent Link Delivered' },
          { stage: 'CAPTURE', action: 'Customer settled via PhonePe UPI intent link' },
        ],
      },
      {
        paymentId: 'pay_OXYZ77102938',
        amount: 1200000,
        status: 'SCHEDULED_RETRY',
        assignedRoute: 'ROUTE_A',
        errorCode: 'BANK_SERVER_DOWN',
        isDebitedRisk: false,
        auditTrail: [
          { stage: 'INGRESS', action: 'Bank rail degraded. Enqueued for 1m silent backoff.' },
        ],
      },
      {
        paymentId: 'pay_OXYZ66391029',
        amount: 890000,
        status: 'TERMINAL_DLQ',
        assignedRoute: 'ROUTE_C',
        errorCode: 'CARD_EXPIRED',
        isDebitedRisk: false,
        auditTrail: [
          { stage: 'INGRESS', action: 'Card Expired / Compliance Block. Retries suppressed.' },
        ],
      },
      {
        paymentId: 'pay_OXYZ55192834',
        amount: 320000,
        status: 'DUNNING_SENT',
        assignedRoute: 'ROUTE_B',
        errorCode: 'PAYMENT_CANCELLED_BY_USER',
        isDebitedRisk: false,
        auditTrail: [
          { stage: 'INGRESS', action: 'User cancelled modal' },
          { stage: 'DUNNING', action: 'Conversational WhatsApp reminder dispatched' },
        ],
      },
    ]);

    await Invoice.insertMany([
      {
        invoiceId: 'INV-2026-9379',
        clientName: 'Acme Logistics Pvt Ltd',
        clientEmail: 'kinagiabhishek842@gmail.com',
        clientPhone: '+919876543210',
        amount: 5000000,
        dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        commitmentDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        status: 'ESCALATED_LEGAL',
      },
      {
        invoiceId: 'INV-2026-8812',
        clientName: 'HyperGrowth Tech India',
        clientEmail: 'finance@hypergrowth.in',
        clientPhone: '+919876543211',
        amount: 7500000,
        dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        commitmentDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        status: 'PROMISE_TO_PAY',
      },
      {
        invoiceId: 'INV-2026-7721',
        clientName: 'BlueOcean Retail Ltd',
        clientEmail: 'billing@blueocean.com',
        clientPhone: '+919876543212',
        amount: 3500000,
        dueDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        status: 'PAID',
      },
    ]);

    console.log('✅ [SEEDED] Live test records seeded into active database connection.');
    res.redirect('/dashboard');
  } catch (error: any) {
    res.status(500).send(`Failed to seed data: ${error.message}`);
  }
}

// 2. Render Dashboard
export async function renderDashboard(req: Request, res: Response) {
  try {
    const b2cCount = await RecoveryLedger.countDocuments();
    const b2bCount = await Invoice.countDocuments();

    console.log(`📊 [DASHBOARD QUERY] DB: "${mongoose.connection.name}" | RecoveryLedger: ${b2cCount} | Invoices: ${b2bCount}`);

    const ledgerAgg = await RecoveryLedger.aggregate([
      {
        $group: {
          _id: null,
          totalAtRisk: { $sum: '$amount' },
          totalRecovered: {
            $sum: {
              $cond: [{ $eq: ['$status', 'RECOVERED'] }, { $ifNull: ['$recoveredAmount', '$amount'] }, 0],
            },
          },
          totalCount: { $sum: 1 },
          recoveredCount: {
            $sum: { $cond: [{ $eq: ['$status', 'RECOVERED'] }, 1, 0] },
          },
          routeCCount: {
            $sum: { $cond: [{ $eq: ['$status', 'TERMINAL_DLQ'] }, 1, 0] },
          },
          scheduledRetryCount: {
            $sum: { $cond: [{ $eq: ['$status', 'SCHEDULED_RETRY'] }, 1, 0] },
          },
          dunningSentCount: {
            $sum: { $cond: [{ $eq: ['$status', 'DUNNING_SENT'] }, 1, 0] },
          },
        },
      },
    ]);

    const stats = ledgerAgg.length > 0 ? ledgerAgg[0] : {
      totalAtRisk: 0,
      totalRecovered: 0,
      totalCount: 0,
      recoveredCount: 0,
      routeCCount: 0,
      scheduledRetryCount: 0,
      dunningSentCount: 0,
    };

    const invoiceAgg = await Invoice.aggregate([
      {
        $group: {
          _id: null,
          totalInvoiceAtRisk: { $sum: '$amount' },
          totalInvoiceRecovered: {
            $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, '$amount', 0] },
          },
          ptpActiveCount: {
            $sum: { $cond: [{ $eq: ['$status', 'PROMISE_TO_PAY'] }, 1, 0] },
          },
          escalatedLegalCount: {
            $sum: { $cond: [{ $eq: ['$status', 'ESCALATED_LEGAL'] }, 1, 0] },
          },
          totalInvoices: { $sum: 1 },
        },
      },
    ]);

    const invStats = invoiceAgg.length > 0 ? invoiceAgg[0] : {
      totalInvoiceAtRisk: 0,
      totalInvoiceRecovered: 0,
      ptpActiveCount: 0,
      escalatedLegalCount: 0,
      totalInvoices: 0,
    };

    const grandTotalAtRiskPaise = stats.totalAtRisk + invStats.totalInvoiceAtRisk;
    const grandTotalRecoveredPaise = stats.totalRecovered + invStats.totalInvoiceRecovered;

    const grossRecoveryRate = grandTotalAtRiskPaise > 0
      ? ((grandTotalRecoveredPaise / grandTotalAtRiskPaise) * 100).toFixed(1)
      : '0.0';

    const addressableAtRisk = grandTotalAtRiskPaise - (stats.routeCCount * 250000);
    const aor = addressableAtRisk > 0
      ? ((grandTotalRecoveredPaise / addressableAtRisk) * 100).toFixed(1)
      : grossRecoveryRate;

    const recentLedgers = await RecoveryLedger.find().sort({ _id: -1 }).limit(10).lean();
    const formatINR = (paise: number) => `₹${((paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RevRecover Autonomous Engine</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen p-8 font-sans">
  <div class="max-w-7xl mx-auto">
    <div class="flex justify-between items-center pb-6 border-b border-slate-800">
      <div class="flex items-center gap-3">
        <div class="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 font-bold">
          🛡️ RevRecover
        </div>
        <div>
          <h1 class="text-xl font-bold">Autonomous Revenue Recovery Engine</h1>
          <p class="text-xs text-slate-400">Database: <span class="text-emerald-400 font-mono">${mongoose.connection.name || 'default'}</span></p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <a href="/dashboard/seed" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition shadow">
          ⚡ Seed Sample Telemetry
        </a>
        <button onclick="window.location.reload()" class="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs rounded-lg transition cursor-pointer">
          🔄 Refresh
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 my-8">
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">
        <p class="text-xs font-semibold text-slate-400 uppercase">Live Recovered Capital</p>
        <p class="text-2xl font-bold text-emerald-400 mt-1">${formatINR(grandTotalRecoveredPaise)}</p>
        <p class="text-xs text-slate-400 mt-1 font-medium">${grossRecoveryRate}% of ${formatINR(grandTotalAtRiskPaise)} At-Risk</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">
        <p class="text-xs font-semibold text-slate-400 uppercase">Addressable Rate (AOR)</p>
        <p class="text-2xl font-bold text-blue-400 mt-1">${aor}%</p>
        <p class="text-xs text-slate-400 mt-1 font-medium">Non-Fraud Volume Only</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">
        <p class="text-xs font-semibold text-slate-400 uppercase">Active B2B Watchdogs</p>
        <p class="text-2xl font-bold text-amber-400 mt-1">${invStats.ptpActiveCount + invStats.escalatedLegalCount}</p>
        <p class="text-xs text-slate-400 mt-1 font-medium">${invStats.ptpActiveCount} PTP | ${invStats.escalatedLegalCount} Escalated</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">
        <p class="text-xs font-semibold text-slate-400 uppercase">Route C Penalties Saved</p>
        <p class="text-2xl font-bold text-purple-400 mt-1">${stats.routeCCount} Blocked</p>
        <p class="text-xs text-purple-400 mt-1 font-medium">100% Retries Suppressed</p>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <div class="bg-slate-900 border border-slate-800 p-6 rounded-xl">
        <h3 class="text-sm font-semibold mb-4 text-slate-300">Live Database Population</h3>
        <div class="space-y-4 text-xs">
          <div class="flex justify-between border-b border-slate-800 pb-2">
            <span class="text-slate-400">Total B2C Failure Records:</span>
            <span class="font-bold text-slate-200">${stats.totalCount}</span>
          </div>
          <div class="flex justify-between border-b border-slate-800 pb-2">
            <span class="text-slate-400">Total B2B Invoices:</span>
            <span class="font-bold text-slate-200">${invStats.totalInvoices}</span>
          </div>
          <div class="flex justify-between border-b border-slate-800 pb-2">
            <span class="text-slate-400">Successfully Healed:</span>
            <span class="font-bold text-emerald-400">${stats.recoveredCount}</span>
          </div>
          <div class="flex justify-between border-b border-slate-800 pb-2">
            <span class="text-slate-400">In-Flight Retries / Dunning:</span>
            <span class="font-bold text-blue-400">${stats.scheduledRetryCount + stats.dunningSentCount}</span>
          </div>
          <div class="flex justify-between pb-1">
            <span class="text-slate-400">Terminal Fraud / Compliance:</span>
            <span class="font-bold text-purple-400">${stats.routeCCount}</span>
          </div>
        </div>
      </div>

      <div class="lg:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-xl">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-sm font-semibold text-slate-300">Live Database Audit Stream</h3>
          <span class="text-xs text-slate-500">Real-time Mongoose Query</span>
        </div>
        <div class="divide-y divide-slate-800 text-xs">
          ${
            recentLedgers.length === 0
              ? '<div class="text-center py-8"><p class="text-slate-400 mb-3">No records found in this database.</p><a href="/dashboard/seed" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs">Click here to Seed Data</a></div>'
              : recentLedgers
                  .map(
                    (l: any) => `
            <div class="py-3 flex justify-between items-center">
              <div>
                <span class="px-2 py-0.5 rounded font-mono font-bold ${
                  l.status === 'RECOVERED'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : l.status === 'TERMINAL_DLQ'
                    ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                    : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                }">${l.status}</span>
                <span class="ml-2 font-mono text-slate-400">${l.paymentId || 'N/A'}</span>
                <p class="text-slate-400 mt-1">${l.auditTrail?.[l.auditTrail.length - 1]?.action || 'Event recorded'}</p>
              </div>
              <span class="font-bold text-slate-200">${formatINR(l.amount || 0)}</span>
            </div>
          `
                  )
                  .join('')
          }
        </div>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error: any) {
    res.status(500).send(`<pre>Error loading dashboard: ${error.message}</pre>`);
  }
}