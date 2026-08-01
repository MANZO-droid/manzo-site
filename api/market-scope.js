// [읽기 전용] Supabase market_scope_reports → 프론트가 쓰기 좋은 형태로 반환
// GET /api/market-scope  →  { current: {...}, history: [...] }
// 공개(anon) key만 사용 (읽기 전용, RLS로 보호). 별도 환경변수 설정 불필요.
//
// 2026-08-01: market-scope-data.json 하드코딩을 대체 — 날짜별로 한 행씩
// upsert되는 market_scope_reports 테이블에서 최신 날짜를 current로,
// 나머지를 history로 구성해 기존 프론트 코드가 기대하던 모양 그대로 응답한다.

const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';

function toReport(r) {
  return {
    report_date: r.report_date,
    range_label: r.range_label,
    message_count: r.message_count,
    channel_count: r.channel_count,
    items: r.items || [],
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  try {
    // 최근 30일치(오늘 + 히스토리)만 가져온다.
    const url = `${SUPABASE_URL}/rest/v1/market_scope_reports?select=*&order=report_date.desc&limit=30`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    });
    if (!r.ok) throw new Error('Supabase 조회 실패 ' + r.status + ': ' + (await r.text()));
    const rows = await r.json();

    if (!rows.length) {
      return res.json({ current: {}, history: [] });
    }
    const [latest, ...rest] = rows; // 이미 report_date desc 정렬됨
    res.json({ current: toReport(latest), history: rest.map(toReport) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
