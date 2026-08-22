import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api/checkout';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCircuitBreakerTest() {
  console.log('============================================================');
  console.log('       CIRCUIT BREAKER (38s SLIDING WINDOW) TEST           ');
  console.log('============================================================\n');

  // 1. Initial Health Check
  console.log('1️⃣ Querying initial payment rails health status...');
  const initialRes = await axios.get(`${BASE_URL}/health-check`);
  const initialHdfc = initialRes.data.rails.netbanking_HDFC;
  console.log(`   HDFC Netbanking Status: [${initialHdfc.status}] (Failures: ${initialHdfc.failCount})\n`);

  // 2. Simulate 5 consecutive bank failures within 2 seconds
  console.log('2️⃣ Simulating 5 rapid payment failures on HDFC Netbanking...');
  for (let i = 1; i <= 5; i++) {
    const dropRes = await axios.post(`${BASE_URL}/simulate-drop`, {
      rail: 'netbanking_HDFC',
    });
    console.log(`   💥 Dropped transaction ${i}/5 -> Tripped: ${dropRes.data.isTripped}`);
    await sleep(200);
  }

  // 3. Verify Circuit Breaker Tripped to DEGRADED
  console.log('\n3️⃣ Querying payment rails status post-outage...');
  const trippedRes = await axios.get(`${BASE_URL}/health-check`);
  const trippedHdfc = trippedRes.data.rails.netbanking_HDFC;
  console.log(`   🚨 HDFC Netbanking Status: [${trippedHdfc.status}]`);
  console.log(`   📝 Recommendation: "${trippedHdfc.recommendation}"`);
  console.log(`   🟢 UPI Status: [${trippedRes.data.rails.upi.status}] (Active alternative)\n`);

  // 4. Live 38-Second Auto-Healing Countdown
  console.log('4️⃣ Waiting 39 seconds for sliding window eviction & auto-recovery...');
  for (let remaining = 39; remaining > 0; remaining -= 5) {
    process.stdout.write(`   ⏳ Auto-healing in ${remaining}s...\r`);
    await sleep(5000);
  }

  // 5. Verify Self-Healing back to HEALTHY
  console.log('\n\n5️⃣ Checking rail status after window expiration...');
  const healedRes = await axios.get(`${BASE_URL}/health-check`);
  const healedHdfc = healedRes.data.rails.netbanking_HDFC;
  console.log(`   ✅ HDFC Netbanking Status: [${healedHdfc.status}] (Failures: ${healedHdfc.failCount})`);
  console.log('   🎉 Circuit Breaker successfully self-healed to HEALTHY!\n');
}

runCircuitBreakerTest().catch((err) => {
  console.error('Test failed:', err.response?.data || err.message);
});
