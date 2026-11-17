const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// index.html 안의 "Market Scope" 스크립트(IIFE)를 그대로 떼어내 가짜 DOM에서 실행한다.
// 회귀 대상: /api/market-scope는 { current, history } 구조를 돌려주는데, 예전 poll()은
// 최상위 data.report_date를 봐서 항상 undefined → 10분 폴링이 절대 갱신하지 못했다.
const HTML_PATH = path.join(__dirname, '..', 'index.html');
const START = '// ---------- Market Scope ----------';

function loadScript() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const start = html.indexOf(START);
  assert.notEqual(start, -1, 'index.html에서 Market Scope 스크립트를 찾지 못했다');
  const end = html.indexOf('</script>', start);
  assert.notEqual(end, -1, 'Market Scope 스크립트의 끝을 찾지 못했다');
  return html.slice(start, end);
}

function makeEl(state, id) {
  let text = '';
  let html = '';
  const el = {
    id,
    style: { display: '' },
    classList: { add() {}, remove() {}, contains() { return false; } },
    onclick: null,
    scrollIntoView() {},
  };
  Object.defineProperty(el, 'textContent', {
    get() { return text; },
    set(v) { text = String(v); state.textWrites.push(id); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) { html = String(v); state.htmlWrites.push(id); },
  });
  return el;
}

// 가짜 DOM + fetch/타이머 대역을 만들고 스크립트를 실행한다.
function boot(initialBody, { failFirst = false } = {}) {
  const state = {
    textWrites: [],
    htmlWrites: [],
    fetchCount: 0,
    body: initialBody,
    failNext: failFirst,
    hidden: false,
    intervalMs: null,
    poll: null,
    listeners: {},
  };
  const els = new Map();
  const document = {
    get hidden() { return state.hidden; },
    set hidden(v) { state.hidden = Boolean(v); },
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeEl(state, id));
      return els.get(id);
    },
    addEventListener(type, fn) { state.listeners[type] = fn; },
  };
  const sandbox = {
    document,
    console,
    // 실제 fetch와 같은 비동기 경계를 유지한다.
    fetch: async () => {
      state.fetchCount += 1;
      if (state.failNext) throw new Error('network');
      return { ok: true, status: 200, json: async () => state.body };
    },
    setInterval: (fn, ms) => {
      state.poll = fn;
      state.intervalMs = ms;
      return 1;
    },
  };
  sandbox.window = {};
  sandbox.window.document = document;
  vm.createContext(sandbox);
  vm.runInContext(loadScript(), sandbox);

  return {
    state,
    el: (id) => document.getElementById(id),
    // 최초 로드/폴링의 promise 체인이 끝난 뒤 화면을 읽는다.
    async settle() {
      for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
    },
    isShowing(text) {
      return document.getElementById('ms-tbody').innerHTML.includes(text);
    },
    date: () => document.getElementById('ms-date').textContent,
    setHidden(v) {
      const was = state.hidden;
      state.hidden = Boolean(v);
      if (was && !v && state.listeners.visibilitychange) state.listeners.visibilitychange();
    },
  };
}

function report(date, { updatedAt = '2026-11-17T07:00:00+00:00', name = 'A종목', messages = 100 } = {}) {
  const current = {
    report_date: date,
    range_label: date + ' 05:00 ~ 07:00',
    message_count: messages,
    channel_count: 13,
    items: [
      { name, rank: 1, type: '종목', mention: 9, channel: 3, score: 99, articles: [] },
      { name: name + '2', rank: 2, type: '종목', mention: 4, channel: 2, score: 50, articles: [] },
    ],
  };
  if (updatedAt) current.updated_at = updatedAt;
  return { current, history: [] };
}

test('폴링 주기는 10분이다', async () => {
  const app = boot(report('2026-11-17'));
  await app.settle();
  assert.equal(app.state.intervalMs, 10 * 60 * 1000);
});

test('최초 로드 때 current 안쪽 리포트를 그린다', async () => {
  const app = boot(report('2026-11-17'));
  await app.settle();
  assert.equal(app.date(), '2026-11-17');
  assert.ok(app.isShowing('A종목'));
});

test('같은 날짜라도 갱신시각이 바뀌면 폴링이 화면을 갱신한다 (회귀)', async () => {
  const app = boot(report('2026-11-17', { updatedAt: '2026-11-17T07:00:00+00:00' }));
  await app.settle();
  assert.ok(app.isShowing('A종목'));

  // 같은 기준일, 더 늦게 다시 만들어진(upsert) 리포트
  app.state.body = report('2026-11-17', { updatedAt: '2026-11-17T09:30:00+00:00', name: 'B종목', messages: 180 });
  app.state.poll();
  await app.settle();

  assert.ok(app.isShowing('B종목'), '같은 날짜 upsert도 화면에 반영되어야 한다');
  assert.ok(!app.isShowing('A종목'));
  assert.equal(app.el('ms-msg').textContent, '180개');
});

test('새 기준일 리포트도 폴링이 화면을 갱신한다 (회귀)', async () => {
  const app = boot(report('2026-11-16'));
  await app.settle();
  assert.equal(app.date(), '2026-11-16');

  app.state.body = report('2026-11-17', { updatedAt: null, name: 'C종목' });
  app.state.poll();
  await app.settle();

  assert.equal(app.date(), '2026-11-17');
  assert.ok(app.isShowing('C종목'));
});

test('응답이 그대로면 폴링이 다시 그리지 않는다', async () => {
  const app = boot(report('2026-11-17'));
  await app.settle();
  const before = app.state.htmlWrites.filter((id) => id === 'ms-tbody').length;

  app.state.poll();
  await app.settle();

  const after = app.state.htmlWrites.filter((id) => id === 'ms-tbody').length;
  assert.equal(after, before, '바뀐 것이 없으면 표를 다시 그리지 않아야 한다');
  assert.equal(app.state.fetchCount, 2, '확인 요청 자체는 보내야 한다');
});

test('updated_at이 없어도 내용이 바뀌면 갱신한다', async () => {
  const app = boot(report('2026-11-17', { updatedAt: null, messages: 100 }));
  await app.settle();

  app.state.body = report('2026-11-17', { updatedAt: null, messages: 250, name: 'D종목' });
  app.state.poll();
  await app.settle();

  assert.equal(app.el('ms-msg').textContent, '250개');
  assert.ok(app.isShowing('D종목'));
});

test('최초 로드가 실패해도 다음 폴링에서 복구된다', async () => {
  const app = boot(report('2026-11-17'), { failFirst: true });
  await app.settle();
  assert.match(app.el('ms-range').textContent, /데이터가 아직 준비되지 않았습니다/);

  app.state.failNext = false;
  app.state.poll();
  await app.settle();

  assert.equal(app.date(), '2026-11-17');
  assert.ok(app.isShowing('A종목'));
});

test('백그라운드 탭에서는 요청하지 않고, 다시 보이면 즉시 확인한다', async () => {
  const app = boot(report('2026-11-17'));
  await app.settle();
  assert.equal(app.state.fetchCount, 1);

  app.setHidden(true);
  app.state.poll();
  await app.settle();
  assert.equal(app.state.fetchCount, 1, '숨김 상태에서는 확인 요청을 보내지 않는다');

  app.state.body = report('2026-11-17', { updatedAt: '2026-11-17T10:00:00+00:00', name: 'E종목' });
  app.setHidden(false); // visibilitychange → 즉시 poll()
  await app.settle();

  assert.equal(app.state.fetchCount, 2, '다시 보이면 바로 한 번 확인한다');
  assert.ok(app.isShowing('E종목'));
});
