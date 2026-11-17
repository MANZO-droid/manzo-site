const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/market-scope.js');

// 응답 객체 대역(res) — 핸들러가 쓰는 setHeader/status/json만 흉내낸다.
function fakeRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: null,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

// Supabase 응답 대역 — rows를 그대로 돌려준다.
function stubFetch(rows, { ok = true } = {}) {
  global.fetch = async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => rows,
    text: async () => JSON.stringify(rows),
  });
}

// 파이프라인이 실제로 넣는 모양의 행 하나: 기사에 full_text(원문)가 들어 있다.
function makeRow(date, { itemCount = 2, articleCount = 3, fullTextLen = 700 } = {}) {
  const items = [];
  for (let i = 1; i <= itemCount; i++) {
    const articles = [];
    for (let j = 0; j < articleCount; j++) {
      articles.push({
        url: `https://t.me/ch/${date}/${i}/${j}`,
        title: `${date} 기사 ${i}-${j}`,
        summary: '요약 '.repeat(60),
        full_text: '원문 '.repeat(Math.ceil(fullTextLen / 3)),
      });
    }
    items.push({
      name: `종목${i}`,
      rank: i,
      type: '종목',
      score: 100 - i,
      channel: 3,
      mention: 10 - i,
      articles,
    });
  }
  return {
    report_date: date,
    range_label: `${date} 05:00 ~ 07:00`,
    message_count: 200,
    channel_count: 13,
    items,
  };
}

test('current는 최신 날짜, history는 나머지(날짜 내림차순 그대로)', async () => {
  stubFetch([makeRow('2026-11-16'), makeRow('2026-11-13'), makeRow('2026-11-12')]);
  const res = fakeRes();
  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.current.report_date, '2026-11-16');
  assert.deepEqual(
    res.body.history.map((h) => h.report_date),
    ['2026-11-13', '2026-11-12']
  );
});

test('응답에 기사 원문(full_text)이 실리지 않는다', async () => {
  stubFetch([makeRow('2026-11-16'), makeRow('2026-11-13')]);
  const res = fakeRes();
  await handler({}, res);

  const json = JSON.stringify(res.body);
  assert.ok(!json.includes('full_text'), 'full_text 필드가 응답에 남아 있으면 안 된다');
  for (const report of [res.body.current, ...res.body.history]) {
    for (const item of report.items) {
      for (const article of item.articles) {
        assert.deepEqual(Object.keys(article).sort(), ['summary', 'title', 'url']);
      }
    }
  }
});

test('UI가 쓰는 값은 그대로 남는다 (current 요약값·표 필드·기사 링크)', async () => {
  const row = makeRow('2026-11-16');
  row.items[0].articles[0].full_text = '원문'.repeat(100);
  stubFetch([row]);
  const res = fakeRes();
  await handler({}, res);

  const cur = res.body.current;
  assert.equal(cur.range_label, '2026-11-16 05:00 ~ 07:00');
  assert.equal(cur.message_count, 200);
  assert.equal(cur.channel_count, 13);

  const item = cur.items[0];
  assert.equal(item.name, '종목1');
  assert.equal(item.rank, 1);
  assert.equal(item.type, '종목');
  assert.equal(item.score, 99);
  assert.equal(item.channel, 3);
  assert.equal(item.mention, 9);

  const article = item.articles[0];
  assert.equal(article.url, row.items[0].articles[0].url);
  assert.equal(article.title, row.items[0].articles[0].title);
  assert.equal(article.summary, row.items[0].articles[0].summary);
});

test('같은 날짜 upsert를 프론트가 알아챌 수 있게 updated_at을 그대로 보낸다', async () => {
  const row = makeRow('2026-11-17');
  row.updated_at = '2026-11-17T09:30:00+00:00';
  const older = makeRow('2026-11-16');
  older.updated_at = '2026-11-16T07:05:00+00:00';
  stubFetch([row, older]);
  const res = fakeRes();
  await handler({}, res);

  assert.equal(res.body.current.updated_at, '2026-11-17T09:30:00+00:00');
  assert.equal(res.body.history[0].updated_at, '2026-11-16T07:05:00+00:00');
});

test('updated_at이 없는 행은 null로 보낸다 (프론트가 내용으로 대신 판단)', async () => {
  stubFetch([makeRow('2026-11-17')]);
  const res = fakeRes();
  await handler({}, res);

  assert.equal(res.body.current.updated_at, null);
});

test('기사 모음이 없는 항목도 빈 배열로 안전하게 처리한다', async () => {
  const row = makeRow('2026-11-16');
  delete row.items[0].articles;
  stubFetch([row]);
  const res = fakeRes();
  await handler({}, res);

  assert.deepEqual(res.body.current.items[0].articles, []);
  assert.equal(res.body.current.items[0].name, '종목1');
});

test('CDN 캐시 헤더(30분)를 그대로 유지한다', async () => {
  stubFetch([makeRow('2026-11-16')]);
  const res = fakeRes();
  await handler({}, res);

  assert.match(res.headers['cache-control'], /s-maxage=1800/);
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('데이터가 없으면 빈 current/history를 돌려준다', async () => {
  stubFetch([]);
  const res = fakeRes();
  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { current: {}, history: [] });
});

test('Supabase 조회 실패는 500과 함께 그대로 알린다', async () => {
  stubFetch([], { ok: false });
  const res = fakeRes();
  await handler({}, res);

  assert.equal(res.statusCode, 500);
  assert.ok(res.body.error);
});

test('실제 규모(30일치·기사 원문 포함)에서 응답이 10MB 한도에 여유 있게 들어온다', async () => {
  // 하루 = 15개 항목 × 기사 13건, 30일치. 원문 700자/건은 실측 평균과 비슷한 수준.
  const rows = [];
  for (let d = 30; d >= 1; d--) {
    rows.push(makeRow(`2026-10-${String(d).padStart(2, '0')}`, { itemCount: 15, articleCount: 13 }));
  }

  // 축소 전(원문 포함) 크기
  stubFetch(rows);
  const before = fakeRes();
  // 핸들러를 거치지 않은 원본 응답 크기 — 같은 행을 그대로 직렬화
  const beforeBytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');

  // 축소 후(현재 핸들러) 크기
  await handler({}, before);
  const afterBytes = Buffer.byteLength(JSON.stringify(before.body), 'utf8');

  assert.ok(afterBytes < 10 * 1024 * 1024, `응답이 10MB 미만이어야 한다 (현재 ${afterBytes})`);
  assert.ok(afterBytes < beforeBytes / 2, '원문 제거로 절반 이상 줄어야 한다');
});
