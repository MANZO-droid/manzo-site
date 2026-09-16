// [관리자 전용] 자동화 파이프라인 현황 — 출처·주기(고정 정보) + 최신 수신 여부·데이터
// 정확성(실시간 조회)을 한 번에 반환한다. GET /api/admin-status
//
// admin-users.js와 동일하게 호출자의 로그인 토큰을 ADMIN_EMAIL과 대조해 검증한 뒤에만
// SUPABASE_SERVICE_ROLE_KEY로 세 표(daily_gainers/volume_stocks/market_scope_reports)를
// 조회한다. "메일 발송 시각"은 다루지 않는다 — 구독 이메일이 실제로 저장/발송되는
// 코드가 아직 없어서 보여줄 데이터 자체가 없다(2026-09-16 확인).

const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';

async function verifyAdmin(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const user = await r.json();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !user || !user.email) return null;
  if (user.email.toLowerCase() !== adminEmail.toLowerCase()) return null;
  return user;
}

async function sbSelect(serviceKey, table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) throw new Error(`${table} 조회 실패 ${r.status}: ${await r.text()}`);
  return r.json();
}

function todayKst() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const ms = new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z');
  return Math.round(ms / 86400000);
}

// daysSinceLatest만으로 상태를 매기면 주말·휴장일을 오류로 오인하므로,
// "느슨한" 기준(최대 3일)을 쓰고 화면에 그 취지를 같이 안내한다.
function freshnessStatus(daysSinceLatest) {
  if (daysSinceLatest === null) return 'error';
  if (daysSinceLatest <= 1) return 'ok';
  if (daysSinceLatest <= 3) return 'warn';
  return 'error';
}

module.exports = async (req, res) => {
  const admin = await verifyAdmin(req);
  if (!admin) {
    res.status(403).json({ error: '관리자 권한이 없습니다.' });
    return;
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY가 서버에 설정돼 있지 않습니다.' });
    return;
  }

  try {
    const today = todayKst();
    const sevenDaysAgo = new Date(new Date(today + 'T00:00:00Z').getTime() - 6 * 86400000)
      .toISOString().slice(0, 10);

    const [gainersAll, volumeAll, scopeAll] = await Promise.all([
      sbSelect(serviceKey, 'daily_gainers', 'select=trade_date,report_type,rise_reason,chart_analysis,updated_at&report_type=eq.daily&order=trade_date.desc&limit=200'),
      sbSelect(serviceKey, 'volume_stocks', 'select=trade_date,updated_at&order=trade_date.desc&limit=200'),
      sbSelect(serviceKey, 'market_scope_reports', 'select=report_date,items,updated_at&order=report_date.desc&limit=30'),
    ]);

    // ── 상승률 Top10 (daily_gainers, report_type=daily) ──
    const gainersLatestDate = gainersAll[0] ? gainersAll[0].trade_date : null;
    const gainersLatestRows = gainersAll.filter((r) => r.trade_date === gainersLatestDate);
    const gainersEmptyRise = gainersLatestRows.filter((r) => !r.rise_reason).length;
    const gainersEmptyChart = gainersLatestRows.filter((r) => !r.chart_analysis).length;
    const gainersDays = gainersLatestDate ? daysBetween(today, gainersLatestDate) : null;

    // ── 거래대금 Top10 (volume_stocks) ──
    const volumeLatestDate = volumeAll[0] ? volumeAll[0].trade_date : null;
    const volumeLatestRows = volumeAll.filter((r) => r.trade_date === volumeLatestDate);
    const volumeDays = volumeLatestDate ? daysBetween(today, volumeLatestDate) : null;

    // ── 마켓 스코프 (market_scope_reports) ──
    const scopeLatest = scopeAll[0] || null;
    const scopeItemCount = scopeLatest && Array.isArray(scopeLatest.items) ? scopeLatest.items.length : 0;
    const scopeDays = scopeLatest ? daysBetween(today, scopeLatest.report_date) : null;

    const pipelines = [
      {
        id: 'gainers',
        label: '당일 상승률 Top10',
        source: '네이버 증권 크롤링',
        script: '리서치자동화/scripts/collect_gainers.py',
        schedule: '매일 16:00 KST (개장일만, GitHub Actions)',
        table: 'daily_gainers (report_type=daily)',
        latestDate: gainersLatestDate,
        daysSinceLatest: gainersDays,
        rowCount: gainersLatestRows.length,
        expectedRowCount: 10,
        issues: [
          gainersLatestRows.length !== 10 && gainersLatestDate ? `종목 ${gainersLatestRows.length}/10건만 있음` : null,
          gainersEmptyRise > 0 ? `상승 이유 비어있는 종목 ${gainersEmptyRise}건` : null,
          gainersEmptyChart > 0 ? `차트 분석 비어있는 종목 ${gainersEmptyChart}건` : null,
        ].filter(Boolean),
        lastUpdatedAt: gainersLatestRows.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), gainersLatestRows[0]?.updated_at || null),
        status: freshnessStatus(gainersDays),
      },
      {
        id: 'volume',
        label: '거래대금 Top10',
        source: '네이버 증권 크롤링',
        script: '리서치자동화/scripts/collect_gainers.py (같은 실행)',
        schedule: '매일 16:00 KST (개장일만, GitHub Actions)',
        table: 'volume_stocks',
        latestDate: volumeLatestDate,
        daysSinceLatest: volumeDays,
        rowCount: volumeLatestRows.length,
        expectedRowCount: 10,
        issues: [
          volumeLatestRows.length !== 10 && volumeLatestDate ? `종목 ${volumeLatestRows.length}/10건만 있음` : null,
        ].filter(Boolean),
        lastUpdatedAt: volumeLatestRows.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), volumeLatestRows[0]?.updated_at || null),
        status: freshnessStatus(volumeDays),
      },
      {
        id: 'marketScope',
        label: '마켓 스코프',
        source: '텔레그램 공개 채널 13곳 + Gemini 이슈 탐지',
        script: '리서치자동화/scripts/collect_market_scope.py',
        schedule: '매일 (개장일, GitHub Actions)',
        table: 'market_scope_reports',
        latestDate: scopeLatest ? scopeLatest.report_date : null,
        daysSinceLatest: scopeDays,
        rowCount: scopeItemCount,
        expectedRowCount: 15,
        issues: [
          scopeLatest && scopeItemCount !== 15 ? `종목/이슈 ${scopeItemCount}/15건만 있음` : null,
        ].filter(Boolean),
        lastUpdatedAt: scopeLatest ? scopeLatest.updated_at : null,
        status: freshnessStatus(scopeDays),
      },
      {
        id: 'news',
        label: '최신 경제 헤드라인',
        source: 'RSS 6개사(국내) + 네이버 뉴스 검색(해외)',
        script: 'api/news.js, api/naver-news.js',
        schedule: '방문자가 열 때마다 실시간 (저장 안 함)',
        table: '(없음 — 매번 실시간 호출)',
        latestDate: null,
        daysSinceLatest: null,
        rowCount: null,
        expectedRowCount: null,
        issues: [],
        lastUpdatedAt: null,
        status: 'na',
      },
    ];

    const recent7Days = {
      gainers: Array.from(new Set(gainersAll.map((r) => r.trade_date))).filter((d) => d >= sevenDaysAgo),
      volume: Array.from(new Set(volumeAll.map((r) => r.trade_date))).filter((d) => d >= sevenDaysAgo),
      marketScope: scopeAll.map((r) => r.report_date).filter((d) => d >= sevenDaysAgo),
    };

    res.json({ checkedAt: new Date().toISOString(), today, pipelines, recent7Days });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
