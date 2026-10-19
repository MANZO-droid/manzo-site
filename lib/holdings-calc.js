(function (root) {
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  // 부동소수점 오차(예: 10.000000000000009)를 없애기 위해 퍼센트는 소수 6자리에서 반올림한다.
  function pct(v) {
    return Math.round(v * 1e6) / 1e6;
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  }
  // today: 'YYYY-MM-DD' (KST 기준 오늘). 테스트에서 주입한다.
  function summarize(holding, sales, price, today) {
    const avg = num(holding.avg_price);
    const remaining = num(holding.remaining_qty);
    const close = price ? num(price.close) : null;
    const ma20 = price ? num(price.ma20) : null;
    let realized = 0, soldCost = 0;
    (sales || []).forEach(function (s) {
      const q = num(s.qty), p = num(s.price);
      if (q === null || p === null || avg === null) return;
      realized += (p - avg) * q;
      soldCost += avg * q;
    });
    const hasSales = (sales || []).length > 0;
    const open = holding.status !== 'closed' && remaining > 0;
    const invested = avg !== null && remaining !== null ? avg * remaining : null;
    const marketValue = open && close !== null ? close * remaining : null;
    const unrealized = marketValue !== null && invested !== null ? marketValue - invested : null;
    return {
      remaining: remaining,
      invested: open ? invested : 0,
      marketValue: marketValue,
      unrealized: unrealized,
      unrealizedPct: unrealized !== null && invested ? pct((unrealized / invested) * 100) : null,
      realized: hasSales ? realized : null,
      realizedPct: hasSales && soldCost ? pct((realized / soldCost) * 100) : null,
      maGapPct: open && close !== null && ma20 ? pct((close / ma20 - 1) * 100) : null,
      priceStale: price && price.trade_date && today ? daysBetween(price.trade_date, today) > 5 : false,
    };
  }
  function totals(rows) {
    const t = { invested: 0, marketValue: 0, unrealized: 0, realized: 0 };
    rows.forEach(function (r) {
      if (!r) return;
      ['invested', 'marketValue', 'unrealized', 'realized'].forEach(function (k) {
        if (r[k] !== null && r[k] !== undefined) t[k] += r[k];
      });
    });
    return t;
  }
  function chartPosition(price) {
    const empty = { alignment: null, vs: { ma5: null, ma20: null, ma60: null, ma120: null, high52: null, low52: null } };
    if (!price) return empty;
    const close = num(price.close);
    if (close === null) return empty;
    const rel = function (base) { const b = num(base); return b ? pct((close / b - 1) * 100) : null; };
    const m5 = num(price.ma5), m20 = num(price.ma20), m60 = num(price.ma60);
    let alignment = null;
    if (m5 !== null && m20 !== null && m60 !== null) {
      alignment = m5 > m20 && m20 > m60 ? '정배열' : (m5 < m20 && m20 < m60 ? '역배열' : '혼조');
    }
    return { alignment: alignment, vs: {
      ma5: rel(price.ma5), ma20: rel(price.ma20), ma60: rel(price.ma60), ma120: rel(price.ma120),
      high52: rel(price.high_52w), low52: rel(price.low_52w),
    } };
  }
  const api = { summarize: summarize, totals: totals, chartPosition: chartPosition };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HoldingsCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
