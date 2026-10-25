// [관리자 전용] 회원별 "보유 기록장"·"종목 리포트" 사용 허용 목록 조회·변경.
// GET  /api/admin-member-access            → { enabled: [기록장 허용 user_id...], reportEnabled: [리포트 허용 user_id...] }
// POST /api/admin-member-access            → { userId, enabled, feature? } 로 허용/해제
//        feature: 'holdings'(기본, 생략 시) | 'reports'
//        - 리포트는 기록장이 허용된 회원에게만 켤 수 있다(먼저 기록장 허용 필요).
//        - 기록장을 끄면 리포트도 함께 꺼진다(기본값은 항상 "허용 안 함").
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
    const r = await fetch(`${SUPABASE_URL}/rest/v1/member_feature_access?select=user_id,holdings_enabled,reports_enabled&or=(holdings_enabled.eq.true,reports_enabled.eq.true)`, { headers: H });
    if (!r.ok) return res.status(502).json({ error: '허용 목록을 불러오지 못했습니다' });
    const rows = await r.json();
    return res.status(200).json({
      enabled: rows.filter((x) => x.holdings_enabled).map((x) => x.user_id),
      // 리포트는 기록장과 둘 다 켜져 있을 때만 "허용"으로 본다(DB 함수 member_has_report_access 와 같은 규칙)
      reportEnabled: rows.filter((x) => x.holdings_enabled && x.reports_enabled).map((x) => x.user_id),
    });
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    const feature = b.feature === undefined ? 'holdings' : b.feature;
    if (typeof b.userId !== 'string' || !UUID_RE.test(b.userId) || typeof b.enabled !== 'boolean'
        || (feature !== 'holdings' && feature !== 'reports')) {
      return res.status(400).json({ error: 'userId(UUID)와 enabled(true/false)가 필요합니다. feature는 holdings 또는 reports 입니다' });
    }
    let row;
    if (feature === 'holdings') {
      // 기록장을 끄면 리포트도 함께 끈다(다시 켤 때 리포트가 저절로 살아나지 않게)
      row = { user_id: b.userId, holdings_enabled: b.enabled, granted_at: new Date().toISOString() };
      if (!b.enabled) row.reports_enabled = false;
    } else {
      if (b.enabled) {
        const c = await fetch(`${SUPABASE_URL}/rest/v1/member_feature_access?select=holdings_enabled&user_id=eq.${b.userId}`, { headers: H });
        if (!c.ok) return res.status(502).json({ error: '허용 상태를 확인하지 못했습니다' });
        const cur = await c.json();
        if (!cur.length || !cur[0].holdings_enabled) {
          return res.status(400).json({ error: '먼저 이 회원의 기록장을 허용해야 리포트를 허용할 수 있습니다' });
        }
      }
      row = { user_id: b.userId, reports_enabled: b.enabled };
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/member_feature_access?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([row]),
    });
    if (!r.ok) return res.status(502).json({ error: '저장하지 못했습니다' });
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'GET/POST만 지원합니다' });
};
