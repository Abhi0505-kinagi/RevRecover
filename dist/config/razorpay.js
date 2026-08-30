"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.razorpayClient = void 0;
exports.formatRazorpayAmount = formatRazorpayAmount;
require("dotenv/config");
const razorpay_1 = __importDefault(require("razorpay"));
exports.razorpayClient = new razorpay_1.default({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret',
});
function formatRazorpayAmount(amount, currency = 'INR') {
    const standardUnit = amount / 100;
    if (currency.toUpperCase() === 'INR') {
        return `₹${standardUnit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.toUpperCase(),
    }).format(standardUnit);
}
