import { Request, Response } from 'express';
import { RecoveryLedger } from '../models/RecoveryLedger';
import { Invoice } from '../models/Invoice';
import { CircuitBreakerService } from '../services/circuitBreaker';
import { routeAQueue, routeBQueue } from '../queues/recoveryQueues';

export const getSystemMetrics = async (_req: Request, res: Response): Promise<void> => {
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    // 1. Holistic Aggregate Metrics
    const ledgerStats = await RecoveryLedger.aggregate([
      {
        $group: {
          _id: null,
          grossAtRisk: { $sum: '$amount' },
          totalRecovered: { $sum: '$recoveredAmount' },
          totalTransactions: { $sum: 1 },
          
          // Route segmentation
          routeAAmount: {
            $sum: { $cond: [{ $eq: ['$assignedRoute', 'ROUTE_A'] }, '$amount', 0] },
          },
          routeBAmount: {
            $sum: { $cond: [{ $eq: ['$assignedRoute', 'ROUTE_B'] }, '$amount', 0] },
          },
          routeCAmount: {
            $sum: { $cond: [{ $eq: ['$assignedRoute', 'ROUTE_C'] }, '$amount', 0] },
          },

          // State segmentation
          inFlightAmount: {
            $sum: {
              $cond: [
                { $in: ['$status', ['PENDING', 'SCHEDULED_RETRY', 'DUNNING_SENT']] },
                '$amount',
                0,
              ],
            },
          },
          recoveredCount: {
            $sum: { $cond: [{ $eq: ['$status', 'RECOVERED'] }, 1, 0] },
          },
          terminalDlqCount: {
            $sum: { $cond: [{ $eq: ['$status', 'TERMINAL_DLQ'] }, 1, 0] },
          },

          // Mature cohort calculation (created > 15 mins ago)
          matureGrossAtRisk: {
            $sum: {
              $cond: [{ $lte: ['$createdAt', fifteenMinutesAgo] }, '$amount', 0],
            },
          },
          matureRecovered: {
            $sum: {
              $cond: [{ $lte: ['$createdAt', fifteenMinutesAgo] }, '$recoveredAmount', 0],
            },
          },
        },
      },
    ]);

    const stats = ledgerStats[0] || {
      grossAtRisk: 0,
      totalRecovered: 0,
      totalTransactions: 0,
      routeAAmount: 0,
      routeBAmount: 0,
      routeCAmount: 0,
      inFlightAmount: 0,
      recoveredCount: 0,
      terminalDlqCount: 0,
      matureGrossAtRisk: 0,
      matureRecovered: 0,
    };

    // Addressable Pool = Route A + Route B (excluding Route C fraud/terminal failures)
    const addressableOpportunity = stats.routeAAmount + stats.routeBAmount;

    // Financial KPI Formulations
    const grossRecoveryRate = stats.grossAtRisk > 0
      ? Number(((stats.totalRecovered / stats.grossAtRisk) * 100).toFixed(1))
      : 0;

    const netAddressableOpportunityRate = addressableOpportunity > 0
      ? Number(((stats.totalRecovered / addressableOpportunity) * 100).toFixed(1))
      : 0;

    const matureCohortRate = stats.matureGrossAtRisk > 0
      ? Number(((stats.matureRecovered / stats.matureGrossAtRisk) * 100).toFixed(1))
      : 0;

    // 2. Real-Time Queues & Rails
    const [routeAWaiting, routeBWaiting] = await Promise.all([
      routeAQueue.getWaitingCount(),
      routeBQueue.getWaitingCount(),
    ]);
    const railStatuses = await CircuitBreakerService.getCheckoutRailStatus();
    const invoiceStats = await Invoice.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
    ]);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      financialKPIs: {
        grossRevenueAtRisk: stats.grossAtRisk / 100,
        totalRecovered: stats.totalRecovered / 100,
        inFlightWorkingCapital: stats.inFlightAmount / 100,
        unrecoverableTerminalRisk: stats.routeCAmount / 100,
        rates: {
          grossRecoveryRatePercentage: grossRecoveryRate,
          netAddressableOpportunityRatePercentage: netAddressableOpportunityRate,
          matureCohortRatePercentage_T15m: matureCohortRate,
        },
      },
      workloadDistribution: {
        routeA_Silent5XX_Amount: stats.routeAAmount / 100,
        routeB_AgenticDunning_Amount: stats.routeBAmount / 100,
        routeC_TerminalDLQ_Amount: stats.routeCAmount / 100,
        liveQueueDepths: { routeA_Waiting: routeAWaiting, routeB_Waiting: routeBWaiting },
      },
      circuitBreakerStatus: railStatuses,
      b2bReceivables: invoiceStats,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};