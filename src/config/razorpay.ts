import 'dotenv/config';
import Razorpay from 'razorpay';

export const razorpayClient = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret',
});
export function formatRazorpayAmount(amount: number, currency: string = 'INR'): string {
  const standardUnit = amount / 100;

  if (currency.toUpperCase() === 'INR') {
    return `₹${standardUnit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(standardUnit);
}

