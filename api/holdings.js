// [관리자 전용] 실제 매매 포지션 원장 조회 — GET만 지원한다 (읽기 전용).
// GET /api/holdings → { positions: [...] }
//
// stock_screener(PC) 쪽 positions.py가 관리하는 진짜 추세추종 포지션 원장을 그대로
// 보여준다. 원본은 PC의 history/positions.csv이고, 이 표(stock_screener.trend_positions)는
// 그 사본이다 — enter_position.py/daily_check.py가 시세 데이터로 align_days/rs120 등을
// 계산해서 진입·청산을 기록하므로, 사이트에서 새 포지션을 직접 추가/수정하지는 않는다
// (그 계산은 PC의 market_cache 없이는 할 수 없다. 2026-09-26 결정 — 처음에는 별도의
// my_holdings 표를 만들었었는데, 이미 존재하는 이 원장과 중복돼서 폐기하고 이 원장을
// 직접 읽도록 다시 만들었다).
//
// admin-users.js/admin-status.js와 동일한 패턴으로, 호출자의 로그인 토큰을 ADMIN_EMAIL과
// 대조해 검증한 뒤에만 SUPABASE_SERVICE_ROLE_KEY로 조회한다. trend_positions는 public이
// 아니라 stock_screener 스키마에 있어 Accept-Profile 헤더가 필요하다.

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

module.exports = async (req, res) => {
  const admin = await verifyAdmin(req);
  if (!admin) {
    res.status(403).json({ error: '관리자 권한이 없습니다.' });
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: '읽기 전용 API입니다.' });
    return;
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY가 서버에 설정돼 있지 않습니다.' });
    return;
  }

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/trend_positions?select=*&order=status.asc,entry_date.desc&limit=200`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Accept-Profile': 'stock_screener',
        },
      },
    );
    if (!r.ok) throw new Error(`조회 실패 ${r.status}: ${await r.text()}`);
    res.json({ positions: await r.json() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
