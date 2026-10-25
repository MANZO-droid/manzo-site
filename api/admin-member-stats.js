// [관리자 전용] 회원 매매 익명 통계. 이 API 는 member_holdings / member_holding_sales / user_id 를 직접 읽지 않고,
// 최소 표본 규칙이 적용된 집계 함수(service_role 전용) 결과만 돌려준다. 최소 표본은 서버에서 3 미만으로 내릴 수 없다.
const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';

async function verifyAdmin(req) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const user = await r.json();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !user || !user.email) return null;
  return user.email.toLowerCase() === adminEmail.toLowerCase() ? user : null;
}

module.exports = async function handler(req, res) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: '서버 설정이 없습니다' });
  if (!(await verifyAdmin(req))) return res.status(403).json({ error: '관리자만 사용할 수 있습니다' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 지원합니다' });

  const minN = Math.min(Math.max(parseInt((req.query || {}).minN, 10) || 3, 3), 50);
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const call = (name) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify({ p_min_n: minN }) });
  const [a, b, c] = await Promise.all([
    call('member_stats_summary'),
    call('member_open_aggregate'),
    fetch(`${SUPABASE_URL}/rest/v1/member_feature_access?select=holdings_enabled&holdings_enabled=eq.true`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } }),
  ]);
  if (!a.ok || !b.ok) return res.status(502).json({ error: '통계를 불러오지 못했습니다' });
  const total = (c.headers.get('content-range') || '').split('/')[1];
  return res.status(200).json({ summary: await a.json(), open: await b.json(), accessCount: total ? Number(total) : null });
};
