// [읽기 전용] Supabase market_scope_reports → 프론트가 쓰기 좋은 형태로 반환
// GET /api/market-scope  →  { current: {...}, history: [...] }
// 공개(anon) key만 사용 (읽기 전용, RLS로 보호). 별도 환경변수 설정 불필요.
//
// 2026-08-01: market-scope-data.json 하드코딩을 대체 — 날짜별로 한 행씩
// upsert되는 market_scope_reports 테이블에서 최신 날짜를 current로,
// 나머지를 history로 구성해 기존 프론트 코드가 기대하던 모양 그대로 응답한다.
//
// 2026-11-17: 응답 크기 축소 — 기사 원문(full_text)을 응답에서 뺀다.
// full_text는 기사 모달(index.html openArticleModal)이 쓰지 않는 필드인데
// 응답 전체의 약 76%(8.3MB/11MB)를 차지해 Vercel CDN 캐시 한도(10MB)를 넘기고
// 있었다. DB(market_scope_reports)에는 그대로 남아 있으므로 다시 필요해지면
// 여기서 필드를 추가하면 된다. 프론트가 실제로 쓰는 url/title/summary만 남긴다.

const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';

// 기사 1건 → 프론트(기사 모달: 제목·요약·원문 링크)가 쓰는 필드만.
function toArticle(a) {
  return {
    url: a.url,
    title: a.title,
    summary: a.summary,
  };
}

// 종목/이슈 1건 → 기존 필드는 그대로 두고(프론트 표가 쓰는 값들),
// 기사 배열만 가볍게 만든다.
function toItem(it) {
  return Object.assign({}, it, {
    articles: (it.articles || []).map(toArticle),
  });
}

function toReport(r) {
  return {
    report_date: r.report_date,
    range_label: r.range_label,
    message_count: r.message_count,
    channel_count: r.channel_count,
    items: (r.items || []).map(toItem),
    // 2026-11-17: 같은 날짜에 리포트가 다시 만들어지는(upsert) 경우를 프론트가
    // 알아챌 수 있도록 표의 갱신시각을 함께 보낸다. index.html의 poll()이
    // 기준일 + 이 값으로 버전을 비교한다. 값이 없으면 프론트는 응답 내용으로 대신한다.
    updated_at: r.updated_at || null,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
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
