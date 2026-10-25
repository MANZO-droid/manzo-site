const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, totals } = require('../lib/holdings-calc.js');

test('보유 중: 평가손익은 (현재가-평단)*잔여수량', () => {
  const s = summarize({ avg_price: 10000, initial_qty: 10, remaining_qty: 10, status: 'open' },
    [], { close: 11000, ma20: 10000, trade_date: '2026-10-12' }, '2026-10-12');
  assert.equal(s.unrealized, 10000);
  assert.equal(s.unrealizedPct, 10);
  assert.equal(s.maGapPct, 10);
  assert.equal(s.priceStale, false);
});

test('분할 매도: 실현손익은 매도 건별 (매도가-평단)*수량 합', () => {
  const s = summarize({ avg_price: 10000, initial_qty: 10, remaining_qty: 6, status: 'open' },
    [{ qty: 4, price: 12000 }], { close: 11000, ma20: null, trade_date: '2026-10-12' }, '2026-10-12');
  assert.equal(s.realized, 8000);
  assert.equal(s.unrealized, 6000);
  assert.equal(s.maGapPct, null);
});

test('청산: 평가손익 없음, 실현손익만', () => {
  const s = summarize({ avg_price: 10000, initial_qty: 5, remaining_qty: 0, status: 'closed' },
    [{ qty: 5, price: 9000 }], null, '2026-10-12');
  assert.equal(s.unrealized, null);
  assert.equal(s.realized, -5000);
  assert.equal(s.realizedPct, -10);
});

test('시세 없음: 평가 값은 null (0으로 표시하지 않는다)', () => {
  const s = summarize({ avg_price: 10000, initial_qty: 5, remaining_qty: 5, status: 'open' }, [], null, '2026-10-12');
  assert.equal(s.marketValue, null);
  assert.equal(s.unrealized, null);
});

test('시세가 6일 이상 오래되면 stale', () => {
  const s = summarize({ avg_price: 1, initial_qty: 1, remaining_qty: 1, status: 'open' }, [],
    { close: 1, ma20: 1, trade_date: '2026-10-01' }, '2026-10-12');
  assert.equal(s.priceStale, true);
});

test('숫자 문자열도 처리 (Supabase numeric은 문자열로 온다)', () => {
  const s = summarize({ avg_price: '10000', initial_qty: '10', remaining_qty: '10', status: 'open' },
    [], { close: '10500', ma20: '10000', trade_date: '2026-10-12' }, '2026-10-12');
  assert.equal(s.unrealized, 5000);
});

test('totals: null은 제외하고 합산', () => {
  const t = totals([
    { invested: 100, marketValue: 120, unrealized: 20, realized: 5 },
    { invested: 50, marketValue: null, unrealized: null, realized: -3 },
  ]);
  assert.deepEqual(t, { invested: 150, marketValue: 120, unrealized: 20, realized: 2 });
});

const { chartPosition } = require('../lib/holdings-calc.js');

test('차트 위치: 정배열과 이동평균·52주 대비', () => {
  const c = chartPosition({ close: 110, ma5: 108, ma20: 100, ma60: 90, ma120: 80, high_52w: 120, low_52w: 50 });
  assert.equal(c.alignment, '정배열');
  assert.equal(c.vs.ma20, 10);
  assert.ok(Math.abs(c.vs.high52 - (-8.3333)) < 0.001);
  assert.equal(c.vs.low52, 120);
});

test('차트 위치: 역배열과 혼조', () => {
  assert.equal(chartPosition({ close: 70, ma5: 72, ma20: 80, ma60: 90 }).alignment, '역배열');
  assert.equal(chartPosition({ close: 100, ma5: 95, ma20: 100, ma60: 90 }).alignment, '혼조');
});

test('차트 위치: 값이 없으면 null (추측하지 않는다)', () => {
  const c = chartPosition({ close: 100, ma5: 99, ma20: 98, ma60: null, ma120: null, high_52w: null, low_52w: null });
  assert.equal(c.alignment, null);
  assert.equal(c.vs.ma60, null);
  assert.equal(c.vs.high52, null);
  assert.equal(chartPosition(null).alignment, null);
});
