// [관리자 전용] 회원 목록 조회 + 행동 통계 집계 + 강제 탈퇴
// GET    /api/admin-users   → { users: [...] }
// DELETE /api/admin-users?id=<user-id> → 회원 강제 탈퇴
//
// 호출한 사람이 실제 로그인 상태이고, 그 이메일이 Vercel 환경변수
// ADMIN_EMAIL과 정확히 일치할 때만 응답한다. SUPABASE_SERVICE_ROLE_KEY(RLS
// 우회)는 이 서버 함수 안에서만 쓰고 브라우저로 절대 내려보내지 않는다.

const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
// 로그인 토큰 검증에만 쓰는 공개 anon key (index.html에 이미 노출된 값과 동일)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';

// Authorization: Bearer <토큰>을 실제로 Supabase에 물어 검증하고, 관리자
// 이메일과 일치하는 경우에만 그 사용자 정보를 반환한다(아니면 null).
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

async function fetchAllAuthUsers(serviceKey) {
  // GoTrue admin API는 페이지네이션됨(기본 50) - 회원 수가 많아질 걸 대비해
  // 페이지를 끝까지 순회한다.
  const users = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const r = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!r.ok) throw new Error(`회원 목록 조회 실패 ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const batch = data.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > 50) break; // 안전장치(회원 1만 명 넘으면 이 API 자체를 다시 설계해야 함)
  }
  return users;
}

async function fetchEventStats(serviceKey) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/user_events?select=user_id,event_type,duration_ms,created_at&order=created_at.desc&limit=50000`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!r.ok) return {}; // user_events 표가 아직 없어도(마이그레이션 전) 500으로 막지 않음
  const events = await r.json();

  const stats = {};
  for (const e of events) {
    const s = stats[e.user_id] || (stats[e.user_id] = {
      totalDurationMs: 0, clickCount: 0, pageViewCount: 0, lastActivity: null,
    });
    if (e.event_type === 'duration') s.totalDurationMs += (e.duration_ms || 0);
    else if (e.event_type === 'click') s.clickCount += 1;
    else if (e.event_type === 'page_view') s.pageViewCount += 1;
    if (!s.lastActivity || e.created_at > s.lastActivity) s.lastActivity = e.created_at;
  }
  return stats;
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
    if (req.method === 'DELETE') {
      const targetId = (req.query && req.query.id) || '';
      if (!targetId) {
        res.status(400).json({ error: 'id가 필요합니다.' });
        return;
      }
      if (targetId === admin.id) {
        res.status(400).json({ error: '자기 자신은 탈퇴시킬 수 없습니다.' });
        return;
      }
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${targetId}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (!r.ok) {
        res.status(500).json({ error: `탈퇴 처리 실패: ${await r.text()}` });
        return;
      }
      res.json({ ok: true });
      return;
    }

    // GET: 회원 목록 + 통계
    const [users, stats] = await Promise.all([
      fetchAllAuthUsers(serviceKey),
      fetchEventStats(serviceKey),
    ]);

    const rows = users.map((u) => ({
      id: u.id,
      email: u.email,
      nickname: (u.user_metadata && u.user_metadata.nickname) || '',
      provider: (u.app_metadata && u.app_metadata.provider) || 'email',
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at || null,
      stats: stats[u.id] || { totalDurationMs: 0, clickCount: 0, pageViewCount: 0, lastActivity: null },
    }));

    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
