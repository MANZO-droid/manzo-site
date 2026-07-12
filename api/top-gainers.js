// [읽기 전용] Supabase daily_gainers → 프론트가 쓰기 좋은 형태로 반환
// GET /api/top-gainers  →  { latestDate, dates: { "2026-07-11": { date, gainers:[...] }, ... } }
// 공개(anon) key만 사용 (읽기 전용, RLS로 보호). 별도 환경변수 설정 불필요.

const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
// index.html에 이미 노출돼 있는 공개 anon key (브라우저 공개 전제 값)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';

// DB 컬럼(snake_case) → 프론트 필드(camelCase) 변환
function toCard(r) {
  return {
    rank: r.rank,
    ticker: r.ticker,
    name: r.name,
    close: r.close,
    changePct: r.change_pct,
    tradeAmount: r.trade_amount,
    ohlcv: r.ohlcv || [],
    technicals: r.technicals || null,
    financials: r.financials || null,
    news: r.news || [],
    riseReason: r.rise_reason || '',
    chartAnalysis: r.chart_analysis || '',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  try {
    // 최근 14일치만 가져와 날짜 탭 구성
    const url = `${SUPABASE_URL}/rest/v1/daily_gainers?select=*&order=trade_date.desc,rank.asc&limit=140`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    });
    if (!r.ok) throw new Error('Supabase 조회 실패 ' + r.status + ': ' + (await r.text()));
    const rows = await r.json();

    const dates = {};
    for (const row of rows) {
      const d = row.trade_date;
      if (!dates[d]) dates[d] = { date: d, gainers: [] };
      dates[d].gainers.push(toCard(row));
    }
    for (const d of Object.keys(dates)) dates[d].gainers.sort((a, b) => a.rank - b.rank);

    const allDates = Object.keys(dates).sort();
    const latestDate = allDates[allDates.length - 1] || null;

    res.json({ latestDate, dates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
