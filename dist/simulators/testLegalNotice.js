"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const Invoice_1 = require("../models/Invoice");
const legalNoticeService_1 = require("../services/legalNoticeService");
const recoveryQueues_1 = require("../queues/recoveryQueues");
const db_1 = require("../config/db");
async function runLegalNoticeTestbench() {
    console.log('🔄 [TESTBENCH] Initializing Database Connection...');
    await (0, db_1.connectDB)();
    console.log('\n================================================================');
    console.log('       STAGE 1: STATUTORY PENALTY & INTEREST CALCULATION        ');
    console.log('================================================================');
    const testPrincipalPaise = 5000000; // ₹50,000.00
    const tenDaysAgoStr = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const penaltyCalc = legalNoticeService_1.LegalNoticeService.calculatePenalty(testPrincipalPaise, tenDaysAgoStr, 0.18, // 18% p.a.
    100000 // ₹1,000 flat late fee
    );
    console.log(`Principal Amount:    ${penaltyCalc.principalFormatted}`);
    console.log(`Days Overdue:        ${penaltyCalc.daysOverdue} days`);
    console.log(`Accrued Interest:    ${penaltyCalc.interestAccruedFormatted}`);
    console.log(`Administrative Fee:  ${penaltyCalc.lateFeeFormatted}`);
    console.log(`Total Demand Due:    ${penaltyCalc.totalPayableFormatted}`);
    if (penaltyCalc.daysOverdue >= 10 && penaltyCalc.interestAccruedPaise > 0) {
        console.log('✅ PASS: Penalty math verified (Daily interest + Late fee accrued).');
    }
    else {
        console.error('❌ FAIL: Penalty math calculation mismatch.');
    }
    console.log('\n================================================================');
    console.log('       STAGE 2: B2B PTP BREACH & STATE MACHINE ESCALATION       ');
    console.log('================================================================');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const testInvoiceId = `INV-2026-${randomSuffix}`;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    // 1. Create Breached Invoice (Strict match to IInvoice schema)
    const invoice = await Invoice_1.Invoice.create({
        invoiceId: testInvoiceId,
        clientName: 'Acme Logistics Pvt Ltd',
        clientEmail: 'kinagiabhishek842@gmail.com',
        clientPhone: '+919876543210',
        amount: testPrincipalPaise,
        currency: 'INR',
        dueDate: tenDaysAgo,
        status: 'PROMISE_TO_PAY',
        ptpDate: yesterday, // Breached commitment
        escalationLevel: 1,
        ptpNotes: 'Client promised payment by yesterday via WhatsApp.',
    });
    console.log(`Created Test Invoice: ${invoice.invoiceId}`);
    console.log(`Initial Status:       ${invoice.status}`);
    console.log(`Breached PTP Date:    ${invoice.ptpDate?.toISOString().split('T')[0]}`);
    // 2. Enqueue Breach Watchdog Job
    console.log('\nDispatching job to ptp-watchdog-queue...');
    await recoveryQueues_1.ptpWatchdogQueue.add('check-ptp-breach', { invoiceId: invoice._id.toString() });
    console.log('⏳ Awaiting BullMQ worker execution (4 seconds)...');
    await new Promise((resolve) => setTimeout(resolve, 4000));
    // 3. Verify Database State Transition
    const updatedInvoice = await Invoice_1.Invoice.findById(invoice._id);
    console.log('\n================================================================');
    console.log('                    VERIFICATION RESULTS                        ');
    console.log('================================================================');
    console.log(`Target Invoice:   ${updatedInvoice?.invoiceId}`);
    console.log(`Current Status:   ${updatedInvoice?.status} (Expected: ESCALATED_LEGAL)`);
    console.log(`Client Contact:   ${updatedInvoice?.clientEmail} | ${updatedInvoice?.clientPhone}`);
    if (updatedInvoice?.status === 'ESCALATED_LEGAL') {
        console.log('\n🎉 ALL TESTS PASSED: State machine escalated to ESCALATED_LEGAL and Legal Demand Notice was triggered.');
    }
    else {
        console.log(`\n❌ TEST FAILED: Invoice status is "${updatedInvoice?.status}", expected "ESCALATED_LEGAL".`);
        console.log('👉 Ensure "npm run dev" is actively running in another terminal to process the BullMQ job.');
    }
    // Cleanup test entry
    await Invoice_1.Invoice.deleteOne({ _id: invoice._id });
    console.log('🧹 Cleaned up test record from database.');
    await mongoose_1.default.disconnect();
    process.exit(0);
}
runLegalNoticeTestbench().catch((error) => {
    console.error('Testbench execution error:', error);
    process.exit(1);
});
