// [관리자 전용] 회원별 "보유 기록장" 사용 허용 목록 조회·변경.
// GET  /api/admin-member-access            → { enabled: [user_id, ...] }
// POST /api/admin-member-access            → { userId, enabled } 로 허용/해제
const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function verifyAdmin(req) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
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
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/member_feature_access?select=user_id&holdings_enabled=eq.true`, { headers: H });
    if (!r.ok) return res.status(502).json({ error: '허용 목록을 불러오지 못했습니다' });
    const rows = await r.json();
    return res.status(200).json({ enabled: rows.map((x) => x.user_id) });
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    if (typeof b.userId !== 'string' || !UUID_RE.test(b.userId) || typeof b.enabled !== 'boolean') {
      return res.status(400).json({ error: 'userId(UUID)와 enabled(true/false)가 필요합니다' });
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/member_feature_access?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_id: b.userId, holdings_enabled: b.enabled, granted_at: new Date().toISOString() }]),
    });
    if (!r.ok) return res.status(502).json({ error: '저장하지 못했습니다' });
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'GET/POST만 지원합니다' });
};
