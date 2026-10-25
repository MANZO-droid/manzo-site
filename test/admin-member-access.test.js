// api/admin-member-access.js 의 규칙 검증 (실제 핸들러를 부르고, Supabase 응답만 가짜로 끼운다).
// 실행: node --test test/admin-member-access.test.js
const test = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.ADMIN_EMAIL = 'admin@test.invalid';
const handler = require('../api/admin-member-access.js');

const UID = 'aaaaaaaa-0000-0000-0000-000000000001';

// 가짜 DB 행과 호출 기록. 테스트마다 setup()으로 초기화한다.
let rows, upserts, callerEmail;
function setup(initialRows, email = 'admin@test.invalid') {
  rows = initialRows; upserts = []; callerEmail = email;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ email: callerEmail }) };
    if (u.includes('/rest/v1/member_feature_access')) {
      if ((opts.method || 'GET') === 'POST') { upserts.push(JSON.parse(opts.body)[0]); return { ok: true, json: async () => ({}) }; }
      const m = u.match(/user_id=eq\.([0-9a-f-]+)/);
      const out = m ? rows.filter((r) => r.user_id === m[1]) : rows;
      return { ok: true, json: async () => out };
    }
    throw new Error('예상 밖의 호출: ' + u);
  };
}
async function call(method, body) {
  const out = {};
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method, headers: { authorization: 'Bearer t' }, body }, res);
  return out;
}

test('GET: 기록장 허용 목록과, 둘 다 켜진 회원만 리포트 허용으로 돌려준다', async () => {
  setup([
    { user_id: 'u1', holdings_enabled: true, reports_enabled: true },
    { user_id: 'u2', holdings_enabled: true, reports_enabled: false },
    { user_id: 'u3', holdings_enabled: false, reports_enabled: true },   // 기록장이 꺼져 있으면 리포트 허용으로 보지 않는다
  ]);
  const r = await call('GET');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.enabled, ['u1', 'u2']);
  assert.deepStrictEqual(r.body.reportEnabled, ['u1']);
});

test('POST holdings 허용: feature 생략 시 기록장으로 처리하고 리포트 열은 건드리지 않는다', async () => {
  setup([]);
  const r = await call('POST', { userId: UID, enabled: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(upserts.length, 1);
  assert.strictEqual(upserts[0].user_id, UID);
  assert.strictEqual(upserts[0].holdings_enabled, true);
  assert.ok(!('reports_enabled' in upserts[0]), '기록장을 켤 때 리포트 열을 같이 보내면 안 됨');
});

test('POST holdings 해제: 리포트도 함께 꺼서 저장한다', async () => {
  setup([{ user_id: UID, holdings_enabled: true, reports_enabled: true }]);
  const r = await call('POST', { userId: UID, enabled: false, feature: 'holdings' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(upserts[0].holdings_enabled, false);
  assert.strictEqual(upserts[0].reports_enabled, false);
});

test('POST reports 허용: 기록장이 꺼져 있으면 400, 저장하지 않는다', async () => {
  setup([{ user_id: UID, holdings_enabled: false, reports_enabled: false }]);
  const r = await call('POST', { userId: UID, enabled: true, feature: 'reports' });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /기록장/);
  assert.strictEqual(upserts.length, 0);
});

test('POST reports 허용: 허용 행이 아예 없는 회원도 400', async () => {
  setup([]);
  const r = await call('POST', { userId: UID, enabled: true, feature: 'reports' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(upserts.length, 0);
});

test('POST reports 허용: 기록장이 켜져 있으면 reports_enabled만 저장한다', async () => {
  setup([{ user_id: UID, holdings_enabled: true, reports_enabled: false }]);
  const r = await call('POST', { userId: UID, enabled: true, feature: 'reports' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(upserts[0], { user_id: UID, reports_enabled: true });
});

test('POST reports 해제는 기록장 상태와 상관없이 저장된다', async () => {
  setup([{ user_id: UID, holdings_enabled: false, reports_enabled: true }]);
  const r = await call('POST', { userId: UID, enabled: false, feature: 'reports' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(upserts[0], { user_id: UID, reports_enabled: false });
});

test('잘못된 입력은 400: 알 수 없는 feature, 잘못된 userId, enabled 가 불리언이 아님', async () => {
  setup([]);
  assert.strictEqual((await call('POST', { userId: UID, enabled: true, feature: 'admin' })).status, 400);
  assert.strictEqual((await call('POST', { userId: 'not-a-uuid', enabled: true })).status, 400);
  assert.strictEqual((await call('POST', { userId: UID, enabled: 'yes' })).status, 400);
  assert.strictEqual(upserts.length, 0);
});

test('관리자가 아니면 403이고 DB에 아무것도 쓰지 않는다', async () => {
  setup([], 'someone@else.invalid');
  const r = await call('POST', { userId: UID, enabled: true, feature: 'reports' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(upserts.length, 0);
  assert.strictEqual((await call('GET')).status, 403);
});
