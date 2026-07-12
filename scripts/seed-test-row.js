// [M1 검증용] 키움 없이 목(mock) 상위 10 데이터를 오늘 날짜로 Supabase에 넣어,
// DB → 사이트 렌더 경로가 도는지 먼저 확인하는 스크립트.
// 실행: node scripts/seed-test-row.js
// 필요한 .env.local 값: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
require('./_load-env')();

const { upsertToSupabase, seoulDate } = require('../api/cron-update-gainers');
const { computeTechnicals } = require('../api/_kiwoom');

function mockOhlcv(base) {
  const out = [];
  let price = base * 0.7;
  const today = new Date();
  for (let i = 90; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const date = d.toISOString().slice(0, 10);
    const drift = (Math.random() - 0.45) * base * 0.03;
    const open = Math.max(10, price);
    price = Math.max(10, price + drift);
    const close = price;
    const high = Math.max(open, close) * (1 + Math.random() * 0.02);
    const low = Math.min(open, close) * (1 - Math.random() * 0.02);
    out.push({ date, open: Math.round(open), high: Math.round(high), low: Math.round(low), close: Math.round(close), volume: Math.round(100000 + Math.random() * 500000) });
  }
  return out;
}

(async () => {
  const names = ['목업전자', '테스트바이오', '샘플에너지', '가상소프트', '데모반도체', '모의화학', '예시게임즈', '테스트항공', '샘플조선', '목업제약'];
  const rows = names.map((name, i) => {
    const close = 1000 + Math.round(Math.random() * 50000);
    const ohlcv = mockOhlcv(close);
    ohlcv[ohlcv.length - 1].close = close;
    return {
      rank: i + 1,
      ticker: String(100000 + i).padStart(6, '0'),
      name,
      close,
      change_pct: Math.round((30 - i * 2.3) * 100) / 100,
      trade_amount: close * (500000 + Math.round(Math.random() * 2000000)),
      ohlcv,
      technicals: computeTechnicals(ohlcv),
    };
  });
  try {
    const date = seoulDate();
    const n = await upsertToSupabase(date, rows);
    console.log(`✅ 목 데이터 ${n}건을 ${date} 로 Supabase에 기록했습니다. 이제 사이트에서 확인하세요.`);
  } catch (e) {
    console.error('❌ 실패:', e.message);
    process.exit(1);
  }
})();
