"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const RecoveryLedger_1 = require("../models/RecoveryLedger");
const Invoice_1 = require("../models/Invoice");
async function seedData() {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/revrecover';
    await mongoose_1.default.connect(mongoUri);
    console.log('✅ Connected to MongoDB. Seeding live telemetry records...');
    // 1. Seed B2C Recovery Ledgers
    await RecoveryLedger_1.RecoveryLedger.deleteMany({});
    const b2cRecords = [
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
                { stage: 'INGRESS', action: 'Card Expired / Compliance Block. Retries suppressed to avoid penalty fees.' },
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
    ];
    await RecoveryLedger_1.RecoveryLedger.insertMany(b2cRecords);
    console.log(`📦 Seeded ${b2cRecords.length} B2C payment recovery records.`);
    // 2. Seed B2B Overdue Invoices
    await Invoice_1.Invoice.deleteMany({});
    const b2bInvoices = [
        {
            invoiceId: 'INV-2026-9379',
            clientName: 'Acme Logistics Pvt Ltd',
            clientEmail: 'kinagiabhishek842@gmail.com',
            clientPhone: '+919876543210',
            amount: 5000000,
            dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
            commitmentDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // breached 2 days ago
            status: 'ESCALATED_LEGAL',
        },
        {
            invoiceId: 'INV-2026-8812',
            clientName: 'HyperGrowth Tech India',
            clientEmail: 'finance@hypergrowth.in',
            clientPhone: '+919876543211',
            amount: 7500000,
            dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            commitmentDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days in future
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
    ];
    await Invoice_1.Invoice.insertMany(b2bInvoices);
    console.log(`📑 Seeded ${b2bInvoices.length} B2B invoice records.`);
    await mongoose_1.default.disconnect();
    console.log('\n✨ Database populated successfully! Now refresh http://localhost:3000/dashboard\n');
}
seedData().catch(console.error);
