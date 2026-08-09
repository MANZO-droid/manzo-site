// [읽기 전용] Supabase daily_gainers + volume_stocks → 프론트가 쓰기 좋은 형태로 반환
// GET /api/top-gainers                         → 최근 6일치 (기본, 날짜 탭용)
// GET /api/top-gainers?date=2026-07-05          → 그 날짜 하루치만 (달력에서 옛날 날짜 클릭 시)
// GET /api/top-gainers?availableDates=1         → Supabase에 실제로 있는 날짜 전체 목록만(가벼움, 달력 표시용)
//   → { latestDate, latestVolumeDate, dates: { "2026-07-11": { date, gainers:[...], volumeStocks:[...] }, ... } }
// 공개(anon) key만 사용 (읽기 전용, RLS로 보호). 별도 환경변수 설정 불필요.
//
// 2026-08-09: 날짜 탭은 최근 6일만 보여주고, 그보다 이전 날짜는 달력 팝오버에서
// 고르면 이 API가 그 날짜만 따로 가져오도록 바꿨다(예전엔 최근 14일만 통째로
// 가져와서 그 밖의 과거 날짜는 달력에서도 아예 선택할 수 없었음).

const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
// index.html에 이미 노출돼 있는 공개 anon key (브라우저 공개 전제 값)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function supabaseSelect(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
  });
  if (!r.ok) throw new Error(`Supabase ${table} 조회 실패 ${r.status}: ${await r.text()}`);
  return r.json();
}

// DB 컬럼(snake_case) → 프론트 필드(camelCase) 변환
function toGainerCard(r) {
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

function toVolumeCard(r) {
  return {
    rank: r.rank,
    ticker: r.ticker,
    name: r.name,
    close: r.close,
    changePct: r.change_pct,
    tradeAmount: r.trade_amount,
    naverUrl: r.naver_url,
    investors: r.investors || null,
    prevRank: r.prev_rank,
    priceChange: r.price_change,
    prevTradeAmount: r.prev_trade_amount,
  };
}

function buildDatesMap(gainerRows, volumeRows) {
  const dates = {};
  const ensure = (d) => (dates[d] = dates[d] || { date: d, gainers: [], volumeStocks: [] });
  for (const row of gainerRows) ensure(row.trade_date).gainers.push(toGainerCard(row));
  for (const row of volumeRows) ensure(row.trade_date).volumeStocks.push(toVolumeCard(row));
  for (const d of Object.keys(dates)) {
    dates[d].gainers.sort((a, b) => a.rank - b.rank);
    dates[d].volumeStocks.sort((a, b) => a.rank - b.rank);
  }
  return dates;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  try {
    const { date, availableDates } = req.query || {};

    // ── 모드 1: 실제로 데이터가 있는 날짜 전체 목록만(달력 표시용, 가벼움) ──
    if (availableDates) {
      const [gainerRows, volumeRows] = await Promise.all([
        supabaseSelect('daily_gainers', 'select=trade_date'),
        supabaseSelect('volume_stocks', 'select=trade_date'),
      ]);
      const gainerDates = Array.from(new Set(gainerRows.map((r) => r.trade_date))).sort();
      const volumeDates = Array.from(new Set(volumeRows.map((r) => r.trade_date))).sort();
      res.json({ gainerDates, volumeDates });
      return;
    }

    // ── 모드 2: 특정 날짜 하루치만(달력에서 옛날 날짜를 눌렀을 때) ──
    if (date) {
      if (!DATE_RE.test(date)) {
        res.status(400).json({ error: 'date 형식이 올바르지 않습니다 (YYYY-MM-DD)' });
        return;
      }
      const [gainerRows, volumeRows] = await Promise.all([
        supabaseSelect('daily_gainers', `select=*&trade_date=eq.${date}&order=rank.asc`),
        supabaseSelect('volume_stocks', `select=*&trade_date=eq.${date}&order=rank.asc`),
      ]);
      res.json({ dates: buildDatesMap(gainerRows, volumeRows) });
      return;
    }

    // ── 모드 3(기본): 최근 6일치 — 날짜 탭 구성용 ──
    const [gainerRows, volumeRows] = await Promise.all([
      supabaseSelect('daily_gainers', 'select=*&order=trade_date.desc,rank.asc&limit=60'),
      supabaseSelect('volume_stocks', 'select=*&order=trade_date.desc,rank.asc&limit=60'),
    ]);

    const dates = buildDatesMap(gainerRows, volumeRows);
    const allDates = Object.keys(dates).sort();
    const latestDate = allDates[allDates.length - 1] || null;
    const volumeDates = allDates.filter((d) => dates[d].volumeStocks.length > 0);
    const latestVolumeDate = volumeDates[volumeDates.length - 1] || null;

    res.json({ latestDate, latestVolumeDate, dates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
