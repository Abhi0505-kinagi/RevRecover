import { Request, Response } from 'express';
import { RecoveryLedger } from '../models/RecoveryLedger';
import { Invoice } from '../models/Invoice';
import { CircuitBreakerService } from '../services/circuitBreaker';
import { routeAQueue, routeBQueue } from '../queues/recoveryQueues';

export const getSystemMetrics = async (_req: Request, res: Response): Promise<void> => {
  try {
    // 1. Transaction Recovery Ledger Aggregations
    const ledgerStats = await RecoveryLedger.aggregate([
      {
        $group: {
          _id: null,
          totalAtRisk: { $sum: '$amount' },
          totalRecovered: { $sum: '$recoveredAmount' },
          totalTransactions: { $sum: 1 },
          routeACount: {
            $sum: { $cond: [{ $eq: ['$assignedRoute', 'ROUTE_A'] }, 1, 0] },
          },
          routeBCount: {
            $sum: { $cond: [{ $eq: ['$assignedRoute', 'ROUTE_B'] }, 1, 0] },
          },
          routeCCount: {
            $sum: { $cond: [{ $eq: ['$assignedRoute', 'ROUTE_C'] }, 1, 0] },
          },
          recoveredCount: {
            $sum: { $cond: [{ $eq: ['$status', 'RECOVERED'] }, 1, 0] },
          },
          terminalDlqCount: {
            $sum: { $cond: [{ $eq: ['$status', 'TERMINAL_DLQ'] }, 1, 0] },
          },
        },
      },
    ]);

    const stats = ledgerStats[0] || {
      totalAtRisk: 0,
      totalRecovered: 0,
      totalTransactions: 0,
      routeACount: 0,
      routeBCount: 0,
      routeCCount: 0,
      recoveredCount: 0,
      terminalDlqCount: 0,
    };

    const recoveryRate = stats.totalAtRisk > 0 
      ? Number(((stats.totalRecovered / stats.totalAtRisk) * 100).toFixed(1))
      : 0;

    // 2. B2B Invoices & PTP Summary
    const invoiceStats = await Invoice.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
    ]);

    // 3. Live BullMQ Queue Depths
    const [routeAWaiting, routeBWaiting] = await Promise.all([
      routeAQueue.getWaitingCount(),
      routeBQueue.getWaitingCount(),
    ]);

    // 4. Real-Time Circuit Breaker Rail Status
    const railStatuses = await CircuitBreakerService.getCheckoutRailStatus();

    // 5. Recent 8 Ledger Records with Full Audit Trails
    const recentEvents = await RecoveryLedger.find()
      .sort({ createdAt: -1 })
      .limit(8)
      .select('paymentId amount assignedRoute status errorReason auditTrail createdAt');

    res.status(200).json({
      timestamp: new Date().toISOString(),
      financials: {
        totalRevenueAtRiskInRupees: stats.totalAtRisk / 100,
        totalRecoveredInRupees: stats.totalRecovered / 100,
        recoverySuccessRatePercentage: recoveryRate,
        totalTransactionsIngested: stats.totalTransactions,
      },
      routesBreakdown: {
        routeA_Silent5XX: stats.routeACount,
        routeB_AgenticDunning: stats.routeBCount,
        routeC_TerminalDLQ: stats.routeCCount,
        activeQueueLoad: {
          routeA_WaitingJobs: routeAWaiting,
          routeB_WaitingJobs: routeBWaiting,
        },
      },
      b2bReceivables: invoiceStats,
      circuitBreakerRails: railStatuses,
      recentActivityLedger: recentEvents,
    });
  } catch (error: any) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: error.message });
  }
};