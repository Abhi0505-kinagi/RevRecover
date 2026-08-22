"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateBankFailure = exports.getPaymentOptionsHealth = void 0;
const circuitBreaker_1 = require("../services/circuitBreaker");
const getPaymentOptionsHealth = async (_req, res) => {
    try {
        const railStatuses = await circuitBreaker_1.CircuitBreakerService.getCheckoutRailStatus();
        res.status(200).json({
            timestamp: new Date().toISOString(),
            windowSeconds: 38,
            rails: railStatuses,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getPaymentOptionsHealth = getPaymentOptionsHealth;
const simulateBankFailure = async (req, res) => {
    try {
        const { rail } = req.body; // e.g., "netbanking_HDFC"
        if (!rail) {
            res.status(400).json({ error: 'Missing rail parameter' });
            return;
        }
        const currentFails = await circuitBreaker_1.CircuitBreakerService.recordFailure(rail);
        res.status(200).json({
            message: `Recorded failure for ${rail}`,
            currentFailsInLast38Sec: currentFails,
            isTripped: currentFails >= 5,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.simulateBankFailure = simulateBankFailure;
