import 'dotenv/config';
import Razorpay from 'razorpay';

const razorpayClient = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const amountPaise = Number(process.argv[2] || 249900);

async function main() {
  const order = await razorpayClient.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: `bench_manual_${Date.now()}`,
  });

  console.log('\nOrder ID:', order.id);
  console.log('Amount:  ₹' + (amountPaise / 100).toFixed(2));
  console.log('\nOpen this in your browser:');
  console.log(`http://localhost:5000/test-checkout.html?order_id=${order.id}&amount=${amountPaise}\n`);
}

main().catch((e) => {
  console.error('Order creation failed. Full error below:');
  console.error(JSON.stringify(e, null, 2));
  process.exit(1);
});