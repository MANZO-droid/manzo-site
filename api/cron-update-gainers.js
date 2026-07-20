// [매일 자동 실행] 키움 전일대비등락률상위 → Supabase daily_gainers 기록
// Vercel Cron이 하루 한 번 호출합니다 (vercel.json 참고).
// 로컬 수동 실행: node scripts/run-pipeline.js  (아래 스크립트가 이 로직을 재사용)

const { getToken, getTopGainers, getDailyChart, computeTechnicals } = require('./_kiwoom');
const { isTradingDay, getWeeklyReportTrigger } = require('../lib/krx-calendar');

// 오늘 날짜(한국시간) YYYY-MM-DD
function seoulDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 키움에서 상위 10 + 각 종목 일봉/기술지표까지 모아 반환
async function buildGainers({ count = 10 } = {}) {
  const token = await getToken();
  const top = await getTopGainers(token, { count });

  const rows = [];
  for (const s of top) {
    let ohlcv = null;
    let technicals = null;
    try {
      ohlcv = await getDailyChart(token, s.ticker, { limit: 250 });
      technicals = computeTechnicals(ohlcv);
    } catch (e) {
      console.warn('일봉 실패(무시하고 진행):', s.ticker, e.message);
    }
    rows.push({
      rank: s.rank,
      ticker: s.ticker,
      name: s.name,
      close: s.close,
      change_pct: s.changePct,
      trade_amount: s.tradeAmount,
      ohlcv,
      technicals,
    });
    await new Promise((r) => setTimeout(r, 250)); // 키움 요청 제한 배려
  }
  return rows;
}

// Supabase REST로 upsert (자동 필드만 보내 → 수동 필드는 보존됨)
async function upsertToSupabase(tradeDate, rows) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 없음');

  const payload = rows.map((r) => ({ trade_date: tradeDate, updated_at: new Date().toISOString(), ...r }));
  const res = await fetch(
    `${url}/rest/v1/daily_gainers?on_conflict=trade_date,rank`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Supabase 기록 실패 ' + res.status + ': ' + t);
  }
  return payload.length;
}

// 파이프라인 본체 (로컬/서버 공용)
async function run({ count = 10 } = {}) {
  const tradeDate = seoulDate();
  const rows = await buildGainers({ count });
  const n = await upsertToSupabase(tradeDate, rows);
  return { tradeDate, count: n, sample: rows.slice(0, 3).map((r) => ({ rank: r.rank, name: r.name, change_pct: r.change_pct })) };
}

// Vercel 서버리스 핸들러
module.exports = async (req, res) => {
  // 크론 시크릿 보호 (설정된 경우만)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    const q = (req.query && req.query.key) || '';
    if (auth !== 'Bearer ' + secret && q !== secret) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  const today = seoulDate();

  // 참고용: 오늘이 주간(토요일 등) 발행 트리거일인지 미리 계산해 로그로 남긴다.
  // TODO(향후 작업): 주간 집계를 이 Supabase 파이프라인에 완전히 연결하려면
  //   trigger.mode === 'weekly' && trigger.shouldRun 인 경우
  //   trigger.weekStart~trigger.weekEnd 구간의 daily_gainers 로우를 모아
  //   주간 등락률을 재계산해 별도 테이블(예: weekly_gainers)에 upsert하는
  //   로직이 필요하다. 현재 이 함수는 "당일 개장일이면 당일 top10을 기록"하는
  //   daily 파이프라인만 구현하고, 주간 집계/발행은
  //   scripts/collect_gainers.py(JSON 기반, --mode weekly)가 담당한다.
  const trigger = getWeeklyReportTrigger(today);
  if (trigger.mode === 'weekly') {
    console.log(
      `[cron-update-gainers] ${today} 주간 발행 트리거 여부: ${trigger.shouldRun} ` +
      `(weekStart=${trigger.weekStart}, weekEnd=${trigger.weekEnd})`
    );
  }

  // KRX 개장일이 아니면(주말·공휴일) 키움 호출 없이 스킵.
  // vercel.json의 크론은 매일 07:00 UTC(16:00 KST)에 호출되므로,
  // 개장일 판단은 이 함수 안에서 직접 걸러낸다.
  if (!isTradingDay(today)) {
    console.log(`[cron-update-gainers] ${today}는 KRX 개장일이 아니므로 스킵합니다.`);
    return res.json({ ok: true, skipped: true, reason: 'not a trading day', tradeDate: today });
  }

  try {
    const result = await run({ count: 10 });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};

module.exports.run = run;
module.exports.buildGainers = buildGainers;
module.exports.upsertToSupabase = upsertToSupabase;
module.exports.seoulDate = seoulDate;
