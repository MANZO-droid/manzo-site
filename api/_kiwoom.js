// 키움 REST API 공용 도우미 (Vercel 서버·로컬 테스트 공용)
// 파일명이 '_'로 시작하므로 Vercel은 이 파일을 API 엔드포인트로 만들지 않습니다.
//
// 필요한 환경변수: KIWOOM_APPKEY, KIWOOM_SECRET
// (로컬은 .env.local, Vercel은 프로젝트 환경변수)

const HOST = process.env.KIWOOM_HOST || 'https://api.kiwoom.com'; // 모의투자면 https://mockapi.kiwoom.com

// 문자열 섞인 숫자("+1,196", "▲30.00%")를 순수 숫자로 변환
function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// 응답 객체에서 '종목 배열이 담긴 필드'를 자동으로 찾음 (필드명이 TR마다 달라서)
function firstArray(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    if (Array.isArray(obj[k]) && obj[k].length && typeof obj[k][0] === 'object') return obj[k];
  }
  return null;
}

// 여러 후보 키 중 처음 존재하는 값
function pick(row, keys) {
  for (const k of keys) if (row[k] != null && row[k] !== '') return row[k];
  return null;
}

// 이 서버(Vercel 함수)가 외부로 나갈 때 쓰는 IP 확인 (키움 IP 등록 진단용)
async function getOutboundIp() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    return d.ip;
  } catch (e) {
    return '(확인 실패: ' + e.message + ')';
  }
}

async function getToken() {
  const res = await fetch(HOST + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIWOOM_APPKEY,
      secretkey: process.env.KIWOOM_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    // 지정단말기/IP 인증 에러(8050 등)일 때 진단을 돕기 위해 현재 아웃바운드 IP를 함께 표시
    if (String(data.return_msg || '').includes('지정단말기') || data.return_code === 3) {
      const ip = await getOutboundIp();
      throw new Error('키움 토큰 발급 실패(지정단말기): ' + JSON.stringify(data) + ' | 현재 서버 아웃바운드 IP: ' + ip);
    }
    throw new Error('키움 토큰 발급 실패: ' + JSON.stringify(data));
  }
  return data.token;
}

// 전일대비등락률상위 (ka10027) → 상위 종목 원시 리스트
async function getTopGainers(token, { count = 10, market = '000' } = {}) {
  const res = await fetch(HOST + '/api/dostk/rkinfo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      authorization: 'Bearer ' + token,
      'api-id': 'ka10027',
      'cont-yn': 'N',
      'next-key': '',
    },
    body: JSON.stringify({
      mrkt_tp: market,      // 000:전체, 001:코스피, 101:코스닥
      sort_tp: '1',         // 1:상승률
      trde_qty_cnd: '0000', // 전체
      stk_cnd: '0',         // 전체 (우선주/관리종목 제외는 3/1 등)
      crd_cnd: '0',
      updown_incls: '1',    // 상한가 포함
      pric_cnd: '0',
      trde_prica_cnd: '0',
      stex_tp: '3',         // 1:KRX 2:NXT 3:통합
    }),
  });
  const data = await res.json();
  if (String(data.return_code) !== '0' && data.return_code !== 0) {
    throw new Error('ka10027 실패: ' + JSON.stringify(data));
  }
  const list = firstArray(data) || [];
  const mapped = list.slice(0, count).map((row, i) => {
    const close = num(pick(row, ['cur_prc', 'cur_prc_amt']));
    const volume = num(pick(row, ['now_trde_qty', 'trde_qty', 'acc_trde_qty']));
    const tradeAmountRaw = num(pick(row, ['trde_prica', 'acc_trde_prica']));
    return {
      rank: num(pick(row, ['now_rank', 'rank'])) || i + 1,
      // 종목코드에 '_AL' 같은 거래소 구분 접미사가 붙어 오므로 숫자만 추출 (6자리 종목코드)
      ticker: (String(pick(row, ['stk_cd', 'stk_code']) || '').match(/\d+/) || [''])[0],
      name: pick(row, ['stk_nm', 'stk_name']),
      close,
      changePct: num(pick(row, ['flu_rt', 'pred_pre_rt', 'fluc_rt'])),
      // 거래대금 필드가 없으면 현재가 x 거래량으로 근사
      tradeAmount: tradeAmountRaw != null ? tradeAmountRaw : (close != null && volume != null ? close * volume : null),
      _raw: row, // 실제 필드명 확인용 (첫 검증 때만 참고, 이후 제거 가능)
    };
  });
  return mapped;
}

// 오늘(한국시간) 날짜를 YYYYMMDD 문자열로
function todayYYYYMMDD() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

// 주식일봉차트조회 (ka10081) → ohlcv 배열 (최신→과거 순으로 올 수 있어 정렬)
async function getDailyChart(token, ticker, { limit = 250, baseDate } = {}) {
  const res = await fetch(HOST + '/api/dostk/chart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      authorization: 'Bearer ' + token,
      'api-id': 'ka10081',
      'cont-yn': 'N',
      'next-key': '',
    },
    body: JSON.stringify({
      stk_cd: ticker,
      base_dt: baseDate || todayYYYYMMDD(), // 필수값: 기준일(YYYYMMDD)
      upd_stkpc_tp: '1',    // 1:수정주가 반영
    }),
  });
  const data = await res.json();
  if (String(data.return_code) !== '0' && data.return_code !== 0) {
    throw new Error('ka10081(' + ticker + ') 실패: ' + JSON.stringify(data));
  }
  const list = firstArray(data) || [];
  const ohlcv = list.map((row) => {
    const dtRaw = String(pick(row, ['dt', 'stck_bsop_date', 'base_dt']) || '');
    const date = dtRaw.length === 8 ? `${dtRaw.slice(0, 4)}-${dtRaw.slice(4, 6)}-${dtRaw.slice(6, 8)}` : dtRaw;
    return {
      date,
      open: Math.abs(num(pick(row, ['open_pric', 'open_prc', 'stck_oprc'])) ?? 0),
      high: Math.abs(num(pick(row, ['high_pric', 'high_prc', 'stck_hgpr'])) ?? 0),
      low: Math.abs(num(pick(row, ['low_pric', 'low_prc', 'stck_lwpr'])) ?? 0),
      close: Math.abs(num(pick(row, ['cur_prc', 'close_pric', 'stck_clpr'])) ?? 0),
      volume: num(pick(row, ['trde_qty', 'acc_trde_qty'])) ?? 0,
    };
  }).filter((d) => d.date);
  // 날짜 오름차순 정렬 후 최근 limit개
  ohlcv.sort((a, b) => (a.date < b.date ? -1 : 1));
  return ohlcv.slice(-limit);
}

// 기술지표(이동평균 등) 계산
function computeTechnicals(ohlcv) {
  if (!ohlcv || !ohlcv.length) return null;
  const closes = ohlcv.map((d) => d.close);
  const vols = ohlcv.map((d) => d.volume);
  const avgLast = (arr, n) => {
    if (arr.length < n) return null;
    const s = arr.slice(-n).reduce((a, b) => a + b, 0);
    return Math.round((s / n) * 100) / 100;
  };
  return {
    ma5: avgLast(closes, 5),
    ma20: avgLast(closes, 20),
    ma60: avgLast(closes, 60),
    volumeAvg20: avgLast(vols, 20),
    currentClose: closes[closes.length - 1],
  };
}

module.exports = { HOST, getToken, getTopGainers, getDailyChart, computeTechnicals, num };
