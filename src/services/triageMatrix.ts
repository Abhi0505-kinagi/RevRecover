import { RazorpayPaymentEntity, TriageResult } from '../types/razorpay';
import { razorpayClient } from '../config/razorpay';
//diagnose failure root causes and verify if funds were captured late before taking action:
// Hard failures that must never be auto-retried
const TERMINAL_HARD_REASONS = new Set([
  'card_expired',
  'debit_instrument_blocked',
  'debit_instrument_inactive',
  'payment_risk_check_failed',
  'compliance_violation',
  'card_disabled_for_online_payments',
  'bank_account_invalid',
  'beneficiary_account_does_not_exist',
  'beneficiary_account_dormant',
  'card_not_enrolled',
  'user_not_eligible',
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

export class TriageService {
  /**
   * Diagnoses root cause and assigns the failure to Route A, B, or C.
   */
  public static diagnose(payment: RazorpayPaymentEntity): TriageResult {
    const reason = payment.error_reason || '';
    const source = payment.error_source || '';
    const step = payment.error_step || '';

    // Detect potential debited-but-failed states
    const isDebitedRisk = step === 'payment_authorization' || step === 'payment_capture';

    // 1. Terminal Hard Errors -> Route C (Short-circuit to DLQ)
    if (TERMINAL_HARD_REASONS.has(reason) || source === 'business') {
      return {
        route: 'ROUTE_C',
        reason: `Hard failure: ${reason || 'business_error'}`,
        isDebitedRisk: false,
        maxRetries: 0,
        suggestedAction: 'Escalate to merchant; alert customer to update KYC or payment instrument.',
      };
    }

    // 2. Transient 5XX / Gateway drops -> Route A (Silent 1m-2m-5m Retries)
    if (
      TRANSIENT_GATEWAY_REASONS.has(reason) ||
      source === 'gateway' ||
      source === 'internal' ||
      payment.error_code === 'SERVER_ERROR' ||
      payment.error_code === 'GATEWAY_ERROR'
    ) {
      return {
        route: 'ROUTE_A',
        reason: `Transient infrastructure error: ${reason}`,
        isDebitedRisk,
        maxRetries: 3,
        suggestedAction: 'Silent idempotent retry with strict 1m->2m->5m backoff.',
      };
    }

    // 3. Customer Soft Errors (insufficient_funds, cancelled, OTP timeout) -> Route B (Dunning)
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
  public static async verifyLateAuthorization(paymentId: string): Promise<boolean> {
    try {
      const payment = await razorpayClient.payments.fetch(paymentId);
      return payment.status === 'captured';
    } catch (error) {
      return false;
    }
  }
}