"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecoveryLedger = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AuditEntrySchema = new mongoose_1.Schema({
    stage: { type: String, required: true },
    action: { type: String, required: true },
    details: { type: mongoose_1.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now },
}, { _id: false });
const RecoveryLedgerSchema = new mongoose_1.Schema({
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
}, { timestamps: true });
RecoveryLedgerSchema.index({ status: 1, assignedRoute: 1 });
RecoveryLedgerSchema.index({ createdAt: -1 });
exports.RecoveryLedger = mongoose_1.default.model('RecoveryLedger', RecoveryLedgerSchema);
