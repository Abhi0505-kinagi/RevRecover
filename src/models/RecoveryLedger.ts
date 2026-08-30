import mongoose, { Schema, Document } from 'mongoose';
import { RecoveryRoute, RecoveryStatus, ErrorSource, PaymentStep } from '../types/razorpay';

export interface IAuditEntry {
  stage: string;
  action: string;
  details?: Record<string, any>;
  timestamp: Date;
}

export interface IRecoveryLedger extends Document {
  paymentId: string;
  orderId?: string;
  invoiceId?: string;
  amount: number;
  currency: string;
  customerEmail?: string;
  customerContact?: string;
  errorSource?: ErrorSource;
  errorStep?: PaymentStep;
  errorReason?: string;
  errorCode?: string;
  assignedRoute: RecoveryRoute;
  status: RecoveryStatus;
  retryCount: number;
  maxRetries: number;
  isDebitedRisk: boolean;
  recoveredAmount: number;
  paymentLinkUrl?: string;
  recoveryOrderId?: string;
  promiseToPayDate?: Date;
  auditTrail: IAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const AuditEntrySchema = new Schema<IAuditEntry>(
  {
    stage: { type: String, required: true },
    action: { type: String, required: true },
    details: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const RecoveryLedgerSchema = new Schema<IRecoveryLedger>(
  {
    paymentId: { type: String, required: true, unique: true, index: true },
    orderId: { type: String, index: true },
    invoiceId: { type: String, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    customerEmail: { type: String },
    customerContact: { type: String },
    errorSource: { type: String },
    errorStep: { type: String },
    errorReason: { type: String },
    errorCode: { type: String },
    assignedRoute: { 
      type: String, 
      enum: ['ROUTE_A', 'ROUTE_B', 'ROUTE_C'], 
      required: true 
    },
    status: { 
      type: String, 
      enum: ['PENDING', 'SCHEDULED_RETRY', 'DUNNING_SENT', 'PROMISE_TO_PAY_RECORDED', 'RECOVERED', 'TERMINAL_DLQ'], 
      default: 'PENDING' 
    },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    isDebitedRisk: { type: Boolean, default: false },
    recoveredAmount: { type: Number, default: 0 },
    paymentLinkUrl: { type: String },
    recoveryOrderId: { type: String, index: true },
    promiseToPayDate: { type: Date },
    auditTrail: [AuditEntrySchema],
  },
  { timestamps: true }
);
RecoveryLedgerSchema.index({ status: 1, assignedRoute: 1 });
RecoveryLedgerSchema.index({ createdAt: -1 });
export const RecoveryLedger = mongoose.model<IRecoveryLedger>('RecoveryLedger', RecoveryLedgerSchema);