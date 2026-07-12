// 로컬에서 전체 파이프라인(키움 → Supabase)을 수동 실행.
// 실행: node scripts/run-pipeline.js
// 필요한 .env.local 값: KIWOOM_APPKEY, KIWOOM_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
require('./_load-env')();

const { run } = require('../api/cron-update-gainers');

(async () => {
  try {
    console.log('▶ 파이프라인 시작...');
    const result = await run({ count: 10 });
    console.log('✅ 완료:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('❌ 실패:', e.message);
    process.exit(1);
  }
})();
