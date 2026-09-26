// [읽기 전용] Supabase screener_picks → 프론트가 쓰기 좋은 형태로 반환
// GET /api/screener-picks  →  { latestDate, dates: { "2026-09-23": { date, picks:[...] }, ... } }
// 회장님 개인 스터디용 — 주식투자 자동화(①번 모듈)가 매주 토요일 선정하는 Top10.
// publish_member_picks.py(공개 회원 서비스용, 아직 비활성)와는 완전히 별개 파이프라인이다.
// 공개(anon) key만 사용(읽기 전용, RLS로 보호) — api/top-gainers.js와 동일한 패턴.

const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';

function toCard(r) {
  return {
    rank: r.rank,
    ticker: r.stock_code,
    name: r.stock_name,
    marketType: r.market_type,
    sector: r.sector,
    basePrice: r.base_price,
    chartScore: r.chart_score,
    financialScore: r.financial_score,
    finalScore: r.final_score,
    businessSummary: r.business_summary || '',
    selectionReason: r.selection_reason || '',
    chartAnalysis: r.chart_analysis || '',
    financialSummary: r.financial_summary || '',
    financials: r.financials || null,
    materialAnalysis: r.material_analysis || '',
    sectorSummary: r.sector_summary || '',
    newsItems: r.news_items || [],
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  try {
    // 최근 8회차(약 2개월)만 가져와 날짜 탭 구성
    const url = `${SUPABASE_URL}/rest/v1/screener_picks?select=*&order=run_date.desc,rank.asc&limit=80`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    });
    if (!r.ok) throw new Error('Supabase 조회 실패 ' + r.status + ': ' + (await r.text()));
    const rows = await r.json();

    const dates = {};
    for (const row of rows) {
      const d = row.run_date;
      if (!dates[d]) dates[d] = { date: d, picks: [] };
      dates[d].picks.push(toCard(row));
    }
    for (const d of Object.keys(dates)) dates[d].picks.sort((a, b) => a.rank - b.rank);

    const allDates = Object.keys(dates).sort();
    const latestDate = allDates[allDates.length - 1] || null;

    res.json({ latestDate, dates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
