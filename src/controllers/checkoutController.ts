import { Request, Response } from 'express';
import { CircuitBreakerService } from '../services/circuitBreaker';

export const getPaymentOptionsHealth = async (_req: Request, res: Response): Promise<void> => {
  try {
    const railStatuses = await CircuitBreakerService.getCheckoutRailStatus();
    res.status(200).json({
      timestamp: new Date().toISOString(),
      windowSeconds: 38,
      rails: railStatuses,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const simulateBankFailure = async (req: Request, res: Response): Promise<void> => {
  try {
    // Defense-in-depth: Reject in production unless explicitly bypassed by demo key
    const isProduction = process.env.NODE_ENV === 'production';
    const demoBypassHeader = req.headers['x-demo-key'];

    if (isProduction && demoBypassHeader !== 'razorpay_buildathon_demo') {
      res.status(403).json({ error: 'Failure simulation disabled in production' });
      return;
    }

    const { rail } = req.body;
    if (!rail) {
      res.status(400).json({ error: 'Missing rail parameter' });
      return;
    }

    const currentFails = await CircuitBreakerService.recordFailure(rail);
    res.status(200).json({
      message: `Recorded failure for ${rail}`,
      currentFailsInLast38Sec: currentFails,
      isTripped: currentFails >= 5,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};