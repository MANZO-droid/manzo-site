// 키움 REST API - '전일대비 등락률 상위'(ka10027) 데이터가 실제로 오는지 확인하는 테스트 스크립트.
// 실행: node scripts/test-kiwoom.js
// 키는 프로젝트 루트의 .env.local 파일에서 읽습니다 (이 파일은 git에 올라가지 않음).

const fs = require('fs');
const path = require('path');

// --- .env.local 에서 KIWOOM_APPKEY / KIWOOM_SECRET 읽기 (별도 라이브러리 없이) ---
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvLocal();

const HOST = 'https://api.kiwoom.com'; // 실전투자 도메인 (모의투자는 https://mockapi.kiwoom.com)
const APPKEY = process.env.KIWOOM_APPKEY;
const SECRET = process.env.KIWOOM_SECRET;

async function getToken() {
  const res = await fetch(HOST + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: APPKEY,
      secretkey: SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
  }
  return data.token;
}

async function getTopChangeRate(token) {
  const res = await fetch(HOST + '/api/dostk/rkinfo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'authorization': 'Bearer ' + token,
      'api-id': 'ka10027', // 전일대비등락률상위요청
      'cont-yn': 'N',
      'next-key': '',
    },
    body: JSON.stringify({
      mrkt_tp: '000',        // 시장구분 000:전체, 001:코스피, 101:코스닥
      sort_tp: '1',          // 정렬구분 1:상승률, 2:상승폭, 3:하락률, 4:하락폭, 5:보합
      trde_qty_cnd: '0000',  // 거래량조건 0000:전체조회
      stk_cnd: '0',          // 종목조건 0:전체, 3:우선주제외, 1:관리종목제외 등
      crd_cnd: '0',          // 신용조건 0:전체조회
      updown_incls: '1',     // 상하한포함 0:불포함, 1:포함
      pric_cnd: '0',         // 가격조건 0:전체조회
      trde_prica_cnd: '0',   // 거래대금조건 0:전체조회
      stex_tp: '3',          // 거래소구분 1:KRX, 2:NXT, 3:통합
    }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

(async () => {
  if (!APPKEY || !SECRET) {
    console.error('❌ .env.local 에 KIWOOM_APPKEY / KIWOOM_SECRET 이 없습니다.');
    console.error('   프로젝트 루트에 .env.local 파일을 만들고 두 값을 채워주세요.');
    process.exit(1);
  }
  try {
    console.log('① 토큰 발급 중...');
    const token = await getToken();
    console.log('   ✅ 토큰 발급 성공 (앞 12자):', token.slice(0, 12) + '...');

    console.log('② 전일대비 등락률 상위 조회 중...');
    const { status, data } = await getTopChangeRate(token);
    console.log('   HTTP 상태:', status, '| return_code:', data.return_code, '| return_msg:', data.return_msg);

    // 응답에서 종목 배열이 담긴 키를 자동으로 찾아 상위 10개만 미리보기
    const listKey = Object.keys(data).find(k => Array.isArray(data[k]) && data[k].length);
    if (listKey) {
      console.log(`   ✅ 데이터 도착! 배열 필드명: "${listKey}", 총 ${data[listKey].length}개`);
      console.log('   --- 상위 10개 미리보기 ---');
      data[listKey].slice(0, 10).forEach((row, i) => {
        console.log(`   ${String(i + 1).padStart(2)}. ${JSON.stringify(row)}`);
      });
    } else {
      console.log('   ⚠️ 종목 배열을 못 찾음. 전체 응답을 확인하세요:');
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.error('❌ 오류:', e.message);
    process.exit(1);
  }
})();
