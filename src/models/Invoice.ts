import mongoose, { Schema, Document } from 'mongoose';

export type InvoiceStatus = 
  | 'ISSUED'
  | 'OVERDUE'
  | 'PROMISE_TO_PAY'
  | 'PTP_BROKEN'
  | 'PAID'
  | 'ESCALATED_LEGAL';

export interface IInvoice extends Document {
  invoiceId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  amount: number; // In paise (Razorpay standard)
  currency: string;
  dueDate: Date;
  status: InvoiceStatus;
  ptpDate?: Date;
  ptpNotes?: string;
  escalationLevel: number; // 0: None, 1: Soft Nudge, 2: Firm Warning, 3: Account Freeze
  lastContactedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema = new Schema<IInvoice>(
  {
    invoiceId: { type: String, required: true, unique: true, index: true },
    clientName: { type: String, required: true },
    clientEmail: { type: String, required: true },
    clientPhone: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['ISSUED', 'OVERDUE', 'PROMISE_TO_PAY', 'PTP_BROKEN', 'PAID', 'ESCALATED_LEGAL'],
      default: 'ISSUED',
      index: true,
    },
    ptpDate: { type: Date },
    ptpNotes: { type: String },
    escalationLevel: { type: Number, default: 0 },
    lastContactedAt: { type: Date },
  },
  { timestamps: true }
);

export const Invoice = mongoose.model<IInvoice>('Invoice', InvoiceSchema);