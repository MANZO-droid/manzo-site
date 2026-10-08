// [관리자 전용] 실제 매매 포지션 원장 조회 + 보유 종목 등록 "접수".
// GET    /api/holdings          → { positions: [...], requests: [...최근 접수 내역] }
// POST   /api/holdings          → 등록 요청 접수 (stock_screener.position_requests에 pending으로 저장).
//                                 { items: [...최대 10종목] } 또는 한 종목 객체. 전부 통과해야 저장된다.
//                                 mode: import(이미 보유 중) / new(방금 매수) / watch(관찰 전용, 자동 청산 안 함)
// DELETE /api/holdings?id=N     → 아직 pending인 요청만 취소
//
// POST는 원장(trend_positions)에 직접 쓰지 않는다. 원장의 원본은 PC의 positions.csv라서,
// 사이트가 사본에만 쓰면 손절·청산 감시가 안 되는 종목이 생긴다(2026-10-02 결정). 접수함에
// 쌓인 요청은 PC의 TrendPositionIntake 작업(5분마다, process_position_requests.py)이
// 정식 등록하고 결과를 status/message로 돌려놓는다.
//
// 아래는 원래의 읽기 전용 설명이다.
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

const MAX_PENDING = 30;
const MAX_BATCH = 10;   // 한 번에 접수할 수 있는 종목 수(폼의 최대 행 수와 같다)
const MAX_DELETE = 20;  // 한 번에 삭제 요청할 수 있는 항목 수

function sbHeaders(serviceKey, extra) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Accept-Profile': 'stock_screener',
    'Content-Profile': 'stock_screener',
    ...extra,
  };
}

function todayKst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 입력값 검증. 통과하면 { row }, 실패하면 { error }를 돌려준다.
function validateRequest(body) {
  const b = body && typeof body === 'object' ? body : {};
  const code = String(b.stockCode || '').trim();
  if (!/^\d{6}$/.test(code)) return { error: '종목코드는 숫자 6자리여야 합니다.' };

  const price = Number(String(b.entryPrice ?? '').replace(/,/g, ''));
  if (!Number.isFinite(price) || price <= 0 || price >= 1e9) return { error: '매수가를 올바른 숫자로 입력하세요.' };

  let quantity = null;
  const qRaw = String(b.quantity ?? '').replace(/,/g, '').trim();
  if (qRaw !== '') {
    quantity = Number(qRaw);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 1e9) return { error: '수량을 올바른 숫자로 입력하세요.' };
  }

  let entryDate = null;
  const dRaw = String(b.entryDate ?? '').trim();
  if (dRaw !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dRaw) || Number.isNaN(Date.parse(dRaw + 'T00:00:00Z'))) {
      return { error: '매수일은 YYYY-MM-DD 형식이어야 합니다.' };
    }
    if (dRaw > todayKst()) return { error: '매수일이 오늘보다 미래입니다.' };
    entryDate = dRaw;
  }

  // import=이미 보유 중 편입, new=방금 새로 매수, watch=관찰 전용(손절 등으로 자동 청산 안 함)
  const mode = b.mode === 'new' || b.mode === 'watch' ? b.mode : 'import';
  const note = String(b.note ?? '').trim().slice(0, 200) || null;
  return { row: { stock_code: code, entry_price: price, quantity, entry_date: entryDate, mode, note } };
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

async function loadLedger(serviceKey) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/trend_positions?select=stock_code,stock_name,entry_date,status,quantity,remaining_qty&limit=500`,
    { headers: sbHeaders(serviceKey) });
  if (!r.ok) throw new Error(`원장 조회 실패 ${r.status}: ${await r.text()}`);
  return r.json();
}

// 청산(sell)·상태 전환(set_status)·삭제(delete) 요청을 접수함 행으로 바꾼다. 원장 사본에 실제로 있는
// 종목인지도 미리 확인해서, 없는 종목은 접수 단계에서 바로 알려준다. 성공하면 { rows }, 실패하면
// { error, status?, row? }를 돌려준다(row는 delete 항목의 위치).
async function buildActionRows(action, body, serviceKey) {
  const ledger = await loadLedger(serviceKey);

  if (action === 'delete') {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return { error: '삭제할 항목이 없습니다.' };
    if (items.length > MAX_DELETE) return { error: `한 번에 최대 ${MAX_DELETE}개까지 삭제할 수 있습니다.` };
    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const c = String((items[i] || {}).stockCode || '').trim();
      const d = String((items[i] || {}).entryDate || '').trim();
      if (!/^\d{6}$/.test(c) || !isDate(d)) return { error: `${i + 1}번째 항목의 종목코드·진입일이 올바르지 않습니다.`, row: i };
      if (rows.some((r) => r.stock_code === c && r.entry_date === d)) return { error: `${i + 1}번째 항목이 중복됐습니다.`, row: i };
      if (!ledger.some((p) => p.stock_code === c && p.entry_date === d)) {
        return { status: 409, error: `${i + 1}번째 항목을 원장에서 찾을 수 없습니다(이미 삭제됐을 수 있습니다).`, row: i };
      }
      rows.push({ stock_code: c, action: 'delete', entry_date: d });
    }
    return { rows };
  }

  const code = String(body.stockCode || '').trim();
  if (!/^\d{6}$/.test(code)) return { error: '종목코드는 숫자 6자리여야 합니다.' };
  const cur = ledger.find((p) => p.stock_code === code && (p.status === 'open' || p.status === 'watch'));
  if (!cur) return { status: 409, error: '보유 또는 관찰 중인 종목이 아닙니다(이미 청산됐거나 삭제됐을 수 있습니다).' };

  if (action === 'sell') {
    const price = Number(String(body.exitPrice ?? '').replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0 || price >= 1e9) return { error: '매도가를 올바른 숫자로 입력하세요.' };
    let exitDate = null;
    const dRaw = String(body.exitDate ?? '').trim();
    if (dRaw !== '') {
      if (!isDate(dRaw)) return { error: '매도일은 YYYY-MM-DD 형식이어야 합니다.' };
      if (dRaw > todayKst()) return { error: '매도일이 오늘보다 미래입니다.' };
      exitDate = dRaw;
    }
    // 수량(선택): 비우면 전량 매도, 남은 수량보다 적으면 분할 매도(일부만 판 것)로 기록된다.
    let quantity = null;
    const qRaw = String(body.quantity ?? '').replace(/,/g, '').trim();
    if (qRaw !== '') {
      quantity = Number(qRaw);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 1e9) return { error: '매도 수량을 올바른 숫자로 입력하세요.' };
      const total = Number(cur.quantity);
      if (!Number.isFinite(total) || total <= 0) {
        return { status: 409, error: '원장에 수량이 등록돼 있지 않아 일부 매도를 기록할 수 없습니다(수량을 비우고 전량 매도로 기록하세요).' };
      }
      const remaining = cur.remaining_qty == null ? total : Number(cur.remaining_qty);
      if (quantity > remaining + 1e-9) return { error: `남은 수량(${remaining.toLocaleString('ko-KR')}주)보다 많이 팔 수 없습니다.` };
    }
    return { rows: [{ stock_code: code, action: 'sell', exit_price: price, exit_date: exitDate, quantity }] };
  }

  // set_status: 보유(open) ↔ 관찰(watch)
  const target = body.targetStatus;
  if (target !== 'open' && target !== 'watch') return { error: '바꿀 상태는 보유 또는 관찰이어야 합니다.' };
  if (cur.status === target) return { status: 409, error: '이미 그 상태입니다.' };
  return { rows: [{ stock_code: code, action: 'set_status', target_status: target }] };
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
    if (req.method === 'GET') {
      const [pos, reqs] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/trend_positions?select=*&order=status.asc,entry_date.desc&limit=200`,
          { headers: sbHeaders(serviceKey) }),
        fetch(`${SUPABASE_URL}/rest/v1/position_requests?select=*&order=created_at.desc&limit=20`,
          { headers: sbHeaders(serviceKey) }),
      ]);
      if (!pos.ok) throw new Error(`조회 실패 ${pos.status}: ${await pos.text()}`);
      // 접수 내역 조회가 실패해도 포지션 목록은 계속 보여준다.
      const requests = reqs.ok ? await reqs.json() : [];
      res.json({ positions: await pos.json(), requests });
      return;
    }

    if (req.method === 'POST') {
      // 요청 종류(action): register(기본, 보유 종목 등록) / sell(청산) / set_status(보유↔관찰) / delete(원장에서 삭제).
      // 등록 본문은 { items: [...] }(여러 종목) 또는 종목 하나의 객체. 하나라도 잘못되면 전부 접수하지 않는다.
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = body.action || 'register';
      let rows = [];

      if (action === 'register') {
        const items = Array.isArray(body.items) ? body.items : [body];
        if (items.length === 0) { res.status(400).json({ error: '등록할 종목이 없습니다.' }); return; }
        if (items.length > MAX_BATCH) { res.status(400).json({ error: `한 번에 최대 ${MAX_BATCH}종목까지 접수할 수 있습니다.` }); return; }

        for (let i = 0; i < items.length; i++) {
          const { row, error } = validateRequest(items[i]);
          // row는 보낸 목록 기준 위치(0부터) - 화면이 자기 행 번호로 바꿔 보여준다.
          if (error) { res.status(400).json({ error: (items.length > 1 ? `${i + 1}행: ` : '') + error, row: i }); return; }
          const dupAt = rows.findIndex((r) => r.stock_code === row.stock_code);
          if (dupAt >= 0) { res.status(400).json({ error: `${i + 1}행: ${dupAt + 1}번째 종목과 종목코드가 같습니다.`, row: i }); return; }
          rows.push(row);
        }
      } else if (action === 'sell' || action === 'set_status' || action === 'delete') {
        const out = await buildActionRows(action, body, serviceKey);
        if (out.error) { res.status(out.status || 400).json({ error: out.error, row: out.row }); return; }
        rows = out.rows;
      } else {
        res.status(400).json({ error: '알 수 없는 요청 종류입니다.' });
        return;
      }

      const pend = await fetch(
        `${SUPABASE_URL}/rest/v1/position_requests?select=id,stock_code&status=in.(pending,processing)`,
        { headers: sbHeaders(serviceKey) });
      if (!pend.ok) throw new Error(`접수 내역 조회 실패 ${pend.status}: ${await pend.text()}`);
      const pending = await pend.json();
      if (pending.length + rows.length > MAX_PENDING) { res.status(429).json({ error: '대기 중인 요청이 너무 많습니다.' }); return; }
      const clash = rows.findIndex((r) => pending.some((p) => p.stock_code === r.stock_code));
      if (clash >= 0) {
        res.status(409).json({ error: (rows.length > 1 ? `${clash + 1}행: ` : '') + '같은 종목의 요청이 이미 처리 대기 중입니다.', row: clash });
        return;
      }

      // 한 번의 요청으로 넣어서 전부 들어가거나 전부 안 들어가게 한다.
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/position_requests`, {
        method: 'POST',
        headers: sbHeaders(serviceKey, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(rows),
      });
      if (!ins.ok) throw new Error(`접수 실패 ${ins.status}: ${await ins.text()}`);
      const saved = await ins.json();
      res.status(201).json({ requests: saved, request: saved[0] });
      return;
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query && req.query.id);
      if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'id가 올바르지 않습니다.' }); return; }
      // pending일 때만 취소된다 — PC가 이미 가져간(processing) 요청은 되돌릴 수 없다.
      const del = await fetch(
        `${SUPABASE_URL}/rest/v1/position_requests?id=eq.${id}&status=eq.pending`,
        {
          method: 'PATCH',
          headers: sbHeaders(serviceKey, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
          body: JSON.stringify({ status: 'cancelled', message: '사용자가 취소함' }),
        });
      if (!del.ok) throw new Error(`취소 실패 ${del.status}: ${await del.text()}`);
      const changed = await del.json();
      if (!changed.length) { res.status(409).json({ error: '이미 처리가 시작됐거나 끝난 요청이라 취소할 수 없습니다.' }); return; }
      res.json({ request: changed[0] });
      return;
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: '지원하지 않는 요청 방식입니다.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
