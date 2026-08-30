"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnosePaymentFailure = exports.verifyLateAuthorization = exports.TriageService = void 0;
const razorpay_1 = require("../config/razorpay");
//diagnose failure root causes and verify if funds were captured late before taking action:
// Hard failures that must never be auto-retried
const BANK_SECURITY_REASONS = new Set([
    'payment_risk_check_failed',
    'compliance_violation',
]);
const INSTRUMENT_HARD_REASONS = new Set([
    'card_expired',
    'debit_instrument_blocked',
    'debit_instrument_inactive',
    'card_disabled_for_online_payments',
    'card_disabled_for_online_payment',
    'bank_account_invalid',
    'beneficiary_account_does_not_exist',
    'beneficiary_account_dormant',
    'card_not_enrolled',
    'user_not_eligible',
]);
const CUSTOMER_RETRY_REASONS = new Set([
    'card_number_invalid',
    'payment_timed_out',
]);
const CUSTOMER_SOFT_REASONS = new Set([
    'insufficient_fund',
    'insufficient_funds',
    'payment_cancelled',
    'user_cancelled',
    'card_declined',
    'authentication_failed',
    'otp_timeout',
    'verification_failed',
]);
// 5XX & transient gateway blips
const TRANSIENT_GATEWAY_REASONS = new Set([
    'server_error',
    'gateway_error',
    'service_unavailable',
    'gateway_technical_error',
    'bank_technical_error',
    'bank_not_available',
    'issuer_technical_error',
    'payment_declined_due_to_high_traffic',
    'bank_cutoff_in_progress',
    'request_timed_out',
]);
class TriageService {
    /**
     * Diagnoses root cause and assigns the failure to Route A, B, or C.
     */
    static diagnose(payment) {
        const reason = payment.error_reason || '';
        const source = payment.error_source || '';
        const step = payment.error_step || '';
        const normalizedReason = reason.toLowerCase();
        // Detect potential debited-but-failed states
        const isDebitedRisk = step === 'payment_authorization' || step === 'payment_capture';
        // 1. Terminal Hard Errors -> Route C (Short-circuit to DLQ)
        // Terminal Bank Security & Fraud -> Route C (No retry; advise contacting issuing bank)
        if (BANK_SECURITY_REASONS.has(normalizedReason)) {
            return {
                route: 'ROUTE_C',
                reason: `Bank Security Block: ${reason}`,
                isDebitedRisk: false,
                maxRetries: 0,
                suggestedAction: 'Notify merchant: Amount not debited. Advise customer to contact issuing bank.',
            };
        }
        // 2. Terminal Instrument Errors -> Route C (Prompt to change payment method)
        if (INSTRUMENT_HARD_REASONS.has(normalizedReason) || source === 'business') {
            return {
                route: 'ROUTE_C',
                reason: `Invalid Instrument: ${reason || 'business_error'}`,
                isDebitedRisk,
                maxRetries: 0,
                suggestedAction: 'Prompt customer on checkout UI to update card details or select UPI.',
            };
        }
        // 3. Customer data entry / temporary timeout issues -> Route A (Give them time to fix or retry)
        if (CUSTOMER_RETRY_REASONS.has(normalizedReason)) {
            return {
                route: 'ROUTE_A',
                reason: `Customer retry window: ${reason || 'input_error'}`,
                isDebitedRisk,
                maxRetries: 1,
                suggestedAction: 'Hold the failed attempt briefly and let the customer re-enter the card or retry after a short pause.',
            };
        }
        // 4. Transient 5XX / Gateway drops -> Route A (Silent 1m-2m-5m Retries)
        if (TRANSIENT_GATEWAY_REASONS.has(normalizedReason) ||
            source === 'gateway' ||
            source === 'issuer_bank' ||
            source === 'internal' ||
            payment?.error_code === 'SERVER_ERROR' ||
            payment?.error_code === 'GATEWAY_ERROR') {
            return {
                route: 'ROUTE_A',
                reason: `Transient infrastructure error: ${reason}`,
                isDebitedRisk,
                maxRetries: 3,
                suggestedAction: 'Silent idempotent retry with strict 1m->2m->5m backoff.',
            };
        }
        // 5. Customer soft errors -> Route B (Dunning + recovery link)
        if (CUSTOMER_SOFT_REASONS.has(normalizedReason)) {
            return {
                route: 'ROUTE_B',
                reason: `Customer soft drop: ${reason || 'authentication_dropped'}`,
                isDebitedRisk,
                maxRetries: 2,
                suggestedAction: 'Generate 1-click UPI Intent link & trigger context-aware dunning.',
            };
        }
        return {
            route: 'ROUTE_B',
            reason: `Customer soft drop: ${reason || 'authentication_dropped'}`,
            isDebitedRisk,
            maxRetries: 2,
            suggestedAction: 'Generate 1-click UPI Intent link & trigger context-aware dunning.',
        };
    }
    /**
     * Inquest check: Verifies if Razorpay captured this payment late.
     */
    static async verifyLateAuthorization(paymentId) {
        try {
            const payment = await razorpay_1.razorpayClient.payments.fetch(paymentId);
            return payment.status === 'captured';
        }
        catch (error) {
            return false;
        }
    }
}
exports.TriageService = TriageService;
exports.verifyLateAuthorization = TriageService.verifyLateAuthorization;
exports.diagnosePaymentFailure = TriageService.diagnose;
