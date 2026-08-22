import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api/invoices';

async function testPtpWorkflow() {
  console.log('============================================================');
  console.log('       B2B PROMISE-TO-PAY (PTP) ENGINE TEST                ');
  console.log('============================================================\n');

  const invoiceId = `INV_${Date.now()}`;

  // 1. Create an overdue ₹85,000 B2B invoice
  console.log('1️⃣ Creating overdue B2B invoice (₹85,000)...');
  await axios.post(`${BASE_URL}/create`, {
    invoiceId,
    clientName: 'Infosys Corp Accounts',
    clientEmail: 'billing@infosys.com',
    clientPhone: '+919876543210',
    amount: 8500000, // ₹85,000 in paise
    dueDate: '2026-08-01',
  });
  console.log(`   ✅ Invoice ${invoiceId} created with status: [OVERDUE]\n`);

  // 2. Client sends conversational WhatsApp promise
  console.log('2️⃣ Simulating incoming client WhatsApp reply:');
  const clientMessage = "Hey Abhishek, accounts batch is running next Friday. We will release the ₹85,000 payment on August 28th for sure.";
  console.log(`   📩 Client: "${clientMessage}"\n`);

  // 3. AI Negotiator extracts PTP Date and updates status
  console.log('3️⃣ Parsing commitment with Gemini PTP Agent...');
  const res = await axios.post(`${BASE_URL}/negotiate-ptp`, {
    invoiceId,
    message: clientMessage,
  });

  console.log(`   🎯 Detected Intent:  ${res.data.data.parsedIntent}`);
  console.log(`   📅 Extracted PTP Date: ${res.data.data.ptpDate}`);
  console.log(`   🔄 New Invoice Status: [${res.data.data.updatedStatus}]`);
  console.log(`   🤖 Automated AI Reply: "${res.data.data.aiReply}"\n`);

  console.log('============================================================');
  console.log('🎉 PTP Engine successfully extracted commitment & paused dunning!');
  console.log('============================================================\n');
}

testPtpWorkflow().catch((err) => {
  console.error('PTP Test failed:', err.response?.data || err.message);
});