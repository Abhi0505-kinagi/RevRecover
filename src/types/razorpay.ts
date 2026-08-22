export type ErrorSource = 'customer' | 'business' | 'internal' | 'gateway' | 'issuer_bank';

export type PaymentStep = 
  | 'payment_initiation'
  | 'card_enrollment_check'
  | 'payment_authentication'
  | 'payment_authorization'
  | 'payment_capture';

export type RecoveryRoute = 'ROUTE_A' | 'ROUTE_B' | 'ROUTE_C';

export type RecoveryStatus = 
  | 'PENDING'
  | 'SCHEDULED_RETRY'
  | 'DUNNING_SENT'
  | 'PROMISE_TO_PAY_RECORDED'
  | 'RECOVERED'
  | 'TERMINAL_DLQ';

export interface RazorpayPaymentEntity {
  id: string;
  entity: 'payment';
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  order_id?: string;
  invoice_id?: string;
  method?: string;
  email?: string;
  contact?: string;
  error_code?: string;
  error_description?: string;
  error_source?: ErrorSource;
  error_step?: PaymentStep;
  error_reason?: string;
  created_at: number;
}

export interface RazorpayWebhookPayload {
  entity: 'event';
  account_id: string;
  event: 'payment.failed' | 'payment.captured' | 'subscription.pending' | 'order.paid';
  contains: string[];
  payload: {
    payment: {
      entity: RazorpayPaymentEntity;
    };
  };
  created_at: number;
}

export interface TriageResult {
  route: RecoveryRoute;
  reason: string;
  isDebitedRisk: boolean;
  maxRetries: number;
  suggestedAction: string;
}