// KRX(한국거래소) 거래일 판단 공용 모듈 (CommonJS, 외부 의존성 없음)
//
// 데이터 출처: krx-holidays-2026.json (2026년 KRX 휴장일 목록)
//   - 2026년 법정공휴일 + 대체공휴일 + 임시공휴일(6/3 지방선거) + 연말 휴장일(12/31) 포함
//   - 출처: 한국거래소/증권사 공지 및 국내 뉴스 보도(한국경제, MBC 등) 교차 확인.
//     자세한 근거는 저장소 루트 AUTOMATION_NOTES.md 참고.
//   - 2026년 이외 연도는 이 파일에 데이터가 없으므로, 해당 연도 휴장일이 반영되지
//     않습니다(주말만 자동 제외). 매년 초 krx-holidays-YYYY.json을 추가하고
//     HOLIDAY_FILES 배열에 등록해야 합니다.
//
// 이 파일이 구현하는 "주간 리포트 발행일" 규칙 (index.html/README 상 합의된 해석):
//   1) 평일 + 개장일 → 당일(daily) 모드로 그날 상승률 top10을 정리.
//   2) 토요일 → 그 주(월~금) 상승률 top10을 "주간"(weekly) 리포트로 정리해 발행.
//   3) 단, 그 주의 금요일이 휴장일이면 → 발행일이 토요일이 아니라 "금요일"로 당겨짐
//      (월~목 데이터 기준으로 정리해 금요일에 발행).
//   4) 토요일 포함 3일 이상 연속 휴장(예: 목·금이 모두 휴일이라 목~토가 전부 휴장)이면
//      → 그 연휴가 "시작되는 첫 휴일"(위 예시라면 목요일)에 발행.
//   두 규칙(3, 4)은 사실 같은 알고리즘의 특수 사례입니다: 토요일부터 거꾸로
//   훑어 내려가며 "연속된 비거래일(휴장일)" 구간의 첫날을 찾으면, 그 날이 바로
//   발행 트리거일입니다. 아래 getWeeklyReportTrigger 구현 참고.

const fs = require('fs');
const path = require('path');

const HOLIDAY_FILES = [path.join(__dirname, '..', 'krx-holidays-2026.json')];

function loadHolidaySet() {
  const set = new Set();
  for (const file of HOLIDAY_FILES) {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const arr = JSON.parse(raw);
      for (const d of arr) set.add(d);
    } catch (e) {
      // 파일이 없거나 파싱 실패 시 조용히 무시(해당 연도 휴장일 미반영 → 주말만 제외)
    }
  }
  return set;
}

const HOLIDAYS = loadHolidaySet();

// dateStr(YYYY-MM-DD)의 요일: 0=일 ... 6=토 (UTC 기준으로 계산해 로컬 타임존 영향 제거)
function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function isTradingDay(dateStr) {
  const dow = dayOfWeek(dateStr);
  if (dow === 0 || dow === 6) return false; // 주말
  if (HOLIDAYS.has(dateStr)) return false; // 평일 휴장일
  return true;
}

function previousTradingDay(dateStr) {
  let d = addDays(dateStr, -1);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}

function nextTradingDay(dateStr) {
  let d = addDays(dateStr, 1);
  while (!isTradingDay(d)) d = addDays(d, 1);
  return d;
}

// 주간 리포트를 오늘(dateStr) 발행해야 하는지 판단.
// 반환: { shouldRun, weekStart, weekEnd, mode: 'daily' | 'weekly' }
function getWeeklyReportTrigger(dateStr) {
  const dow = dayOfWeek(dateStr);

  // 평일이면서 개장일 → 당일 모드
  if (dow >= 1 && dow <= 5 && isTradingDay(dateStr)) {
    return { shouldRun: true, weekStart: null, weekEnd: null, mode: 'daily' };
  }

  // 일요일은 절대 트리거되지 않음
  if (dow === 0) {
    return { shouldRun: false, weekStart: null, weekEnd: null, mode: 'daily' };
  }

  // 여기 도달하는 경우: 토요일이거나, 평일인데 휴장일인 경우
  // → 이번 주(월~금) 기준 "주간 리포트 발행 트리거일"을 계산
  const mondayOffset = dow === 6 ? 5 : dow - 1; // 토요일이면 -5, 평일(1~5)이면 -(dow-1)
  const monday = addDays(dateStr, -mondayOffset);
  const saturday = addDays(monday, 5);

  // 토요일부터 거꾸로 훑으며 연속된 비거래일(휴장 평일) 구간의 시작일을 찾는다
  let trigger = saturday;
  let cur = addDays(saturday, -1); // 금요일부터 시작
  while (cur >= monday && !isTradingDay(cur)) {
    trigger = cur;
    cur = addDays(cur, -1);
  }

  // 트리거일 하루 전이 실제 "그 주 마지막 거래일"(weekEnd)
  const weekEndCandidate = addDays(trigger, -1);
  const weekEnd = weekEndCandidate >= monday && isTradingDay(weekEndCandidate) ? weekEndCandidate : null;

  const shouldRun = dateStr === trigger && weekEnd !== null;
  return { shouldRun, weekStart: monday, weekEnd, mode: 'weekly' };
}

module.exports = {
  isTradingDay,
  previousTradingDay,
  nextTradingDay,
  getWeeklyReportTrigger,
};
