# CLAUDE.md — 만조 사이트 코드베이스 가이드

## 프로젝트 개요

**만조(Manzo)** — 한국어 경제·금융 분석 뉴스레터 & 차트 아카이브 사이트.
글로벌 거시경제 분석 글, 마켓스코프(텔레그램 채널 기반 종목 언급 집계), 국내·해외 실시간 뉴스 헤드라인, 뉴스레터 아카이브를 제공한다.

**배포:** Vercel (정적 파일 + Serverless API Functions)
**빌드 시스템 없음** — `package.json`, 번들러, 빌드 단계 없음. `git push`가 곧 배포.

---

## 파일 구조

```
manzo-site/
├── index.html              # 메인 홈페이지 (1123줄)
├── article.html            # 분석 글 상세 페이지 (421줄)
├── archive.html            # 뉴스레터 아카이브 (184줄)
├── style.css               # 전역 스타일 (단, HTML 내 <style>이 주력)
├── data.js                 # ⚠️ 미사용 레거시 파일 (어떤 HTML도 로드하지 않음)
├── market-scope-data.json  # 마켓스코프 데이터 (자동 파이프라인이 업데이트)
├── author.jpg              # 필자 사진 (index.html에 base64 inline 내장)
└── api/
    ├── news.js             # Vercel Serverless: RSS 프록시 (CORS 우회)
    └── naver-news.js       # Vercel Serverless: 네이버 검색 API 래퍼
```

---

## 핵심 아키텍처 패턴

### 1. 인라인 데이터 — 가장 중요한 규칙

**`ARTICLES`와 `NEWSLETTERS` 배열은 각 HTML 파일 내부 `<script>` 블록에 직접 임베드되어 있다.**

| 배열 | index.html | article.html | archive.html | data.js |
|------|-----------|--------------|--------------|---------|
| `ARTICLES` | ✅ (line 406) | ✅ (line 165) | ❌ | ✅ (미사용) |
| `NEWSLETTERS` | ✅ (line 430) | ❌ | ✅ (line 143) | ✅ (미사용) |

**콘텐츠 추가/수정 시 모든 관련 HTML 파일에서 동시에 업데이트해야 한다.**
- 새 분석 글 추가 → `index.html`과 `article.html` 양쪽 `ARTICLES` 배열에 추가
- 새 뉴스레터 추가 → `index.html`과 `archive.html` 양쪽 `NEWSLETTERS` 배열에 추가
- `data.js`는 어떤 HTML도 참조하지 않으므로 수정할 필요 없음 (존재만 유지)

### 2. ARTICLES 객체 스키마

```js
{
  id: "8",                        // 문자열 숫자, 순차적 증가
  title: "...",                   // 분석 글 제목
  category: "해외" | "국내" | "지표" | "거래대금 상위",
  date: "2026-06-18",             // YYYY-MM-DD
  summary: "...",                 // 카드에 표시되는 한두 줄 요약
  body: `<p>...</p><h3>...</h3>`, // HTML 마크업 (article.html 상세 뷰)
  chartAlt: "...",                // 차트 alt 텍스트
  tags: ["태그1", "태그2"],
  author: "만조",
  // 선택 — category가 "거래대금 상위"일 때 포함
  topStock: {
    name: "SK하이닉스", code: "000660",
    price: 194500, change: -3200, changePct: -1.62,
    tradeAmount: "2조 1,340억",
    intraday: [198200, ...],      // 장중 데이터 배열 (11개 포인트)
    briefing: "..."               // 당일 거래 요약 텍스트
  }
}
```

index.html의 `ARTICLES`는 `topStock` 데이터를 포함하지만 article.html의 `ARTICLES`는 `body`가 더 중요하다. 두 파일에서 `id`, `title`, `category`, `date`, `summary`, `body`, `tags`, `author`는 동일하게 유지해야 한다.

### 3. CHART_DATA — SVG 차트 설정

차트는 `index.html`과 `article.html` 내 JS로 완전히 클라이언트 사이드에서 SVG로 렌더된다. **실제 시장 데이터가 아니다.**

```js
// index.html line 474
const CHART_DATA = {
  "1": { type:"line", color:"#4A6FA5", label:"10Y UST Yield (%)",
         points:[...], yMin:3.0, yMax:5.0, xLabels:[...] },
  "3": { type:"bar2", colorA:"#4A6FA5", colorB:"#B5914C", labelA:"CPI", labelB:"PCE",
         pointsA:[...], pointsB:[...], ... },
  "6": { type:"candle", seed:60001, startPrice:172000, n:250,
         label:"SK하이닉스 (000660) 일봉 250일" },
};
```

- `type: "line"` — 단일 라인 차트 (선택적 threshold 수평선 지원)
- `type: "bar2"` — 이중 막대 차트 (두 시리즈 비교)
- `type: "candle"` — seeded RNG로 생성된 의사 OHLC 캔들 차트 (실제 데이터 아님, seed로 결정론적 재현)

새 분석 글(`id: "9"` 등) 추가 시 반드시 `CHART_DATA`에도 대응하는 항목 추가.

---

## 스타일 규칙

CSS 변수는 각 HTML 파일의 `<style>` 블록 최상단 `:root{}` 에 정의된다 (세 파일 모두 중복). `style.css`는 존재하지만 글로벌 변수 정의의 주력이 아니다.

**핵심 색상 팔레트:**
```css
--bg: #F7F5F0          /* 크림/린넨 배경 */
--bg-card: #FFFFFF
--bg-hero: #EEE9DF
--accent: #4A6FA5      /* 파란색 — 링크, 버튼, 강조 */
--accent-hover: #3A5A90
--gold: #B5914C        /* 황금색 — eyebrow 태그, 장식 */
--text-primary: #1C1C2E
--text-secondary: #5A5A72
--text-muted: #9494A8
--border: #E5E0D8
```

**카테고리 태그 색상:**
```css
--tag-국내: #E8F4EE / text #2E7D52   (녹색)
--tag-해외: #EBF0F9 / text #2E5282   (파란색)
--tag-지표: #FDF4E7 / text #8A6020   (주황색)
--tag-volume: #FEF0F0 / text #991B1B  (빨간색, "거래대금 상위")
```

---

## Serverless API Functions (`/api/`)

두 함수 모두 Vercel Serverless Function 패턴 (`module.exports = async (req, res) => {...}`).

### `/api/news.js` — RSS 프록시
- **목적:** 브라우저 CORS를 우회하여 외부 RSS/XML 피드 파싱
- **입력:** `?url=<encoded RSS URL>` (선택적 `?debug=1` 파라미터)
- **출력:** `{ ok: true, articles: [{title, link, summary, pubDate}] }` (최대 3개)
- RSS와 Atom 피드 모두 지원, gzip/deflate 디코딩, EUC-KR 인코딩 감지, 리다이렉트 최대 3회
- Google News RSS의 제목 뒤 `" - 출처명"` 자동 제거, 제목 반복 description 공백 처리

### `/api/naver-news.js` — 네이버 검색 API 래퍼
- **목적:** 네이버 뉴스 검색 API 호출 (NAVER_CLIENT_ID/SECRET 서버사이드 보호)
- **입력:** `?query=<검색어>`
- **출력:** `{ ok: true, articles: [{title, link, summary, pubDate}] }` (최대 3개)
- **환경변수 필요:** `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (Vercel 대시보드에서 설정)

### 뉴스 소스 설정 (`index.html` line 1015–1031)
```js
var SOURCES_KR = [
  { name: '한국경제', color: '#1565c0', naver: '한국경제 경제' },  // Naver API 사용
  { name: '매일경제', color: '#c62828', rss: 'https://www.mk.co.kr/rss/30000001/' },
  // ...
];
var SOURCES_INTL = [
  { name: 'Wall Street Journal', rss: 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml' },
  // ...
];
```
- `naver` 키가 있으면 `/api/naver-news` 사용, 없으면 `/api/news?url=` 사용
- 해외 탭은 첫 전환 시 1회만 로드 (lazy loading)

---

## 마켓스코프 (`market-scope-data.json`)

자동 파이프라인(외부)이 주기적으로 `market-scope-data.json`을 업데이트한다.

**JSON 스키마:**
```json
{
  "current": {
    "report_date": "2026-06-29",
    "range_label": "2026-06-26(금) 05:00 ~ 2026-06-29(월) 04:59 KST",
    "message_count": 53,
    "channel_count": 13,
    "items": [
      {
        "rank": 1,
        "name": "SK하이닉스",
        "type": "종목",
        "mention": 11,
        "channel": 4,
        "score": 19,
        "articles": [
          { "title": "...", "summary": "...", "url": "https://t.me/..." }
        ]
      }
    ]
  },
  "history": [
    { "report_date": "2026-06-25", "range_label": "...", "message_count": 285, "channel_count": 13, "items": [...] }
  ]
}
```

- `items`의 `articles` 배열: 텔레그램 채널 메시지 링크 (`t.me/...`)
- `history`는 과거 리포트 배열; 날짜 내림차순 정렬은 클라이언트에서 처리
- 클라이언트는 10분마다 폴링, `report_date` 변경 시에만 재렌더

---

## 인증 (Supabase)

```js
// index.html line 892-894
const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
const SUPABASE_KEY = 'eyJ...'; // anon key — 공개 노출 의도적, 보안 문제 아님
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
```

- Supabase anon key는 클라이언트 사이드에 노출되도록 설계된 공개 키다. 비밀 키가 아니다.
- 지원 로그인: 이메일/비밀번호, 구글 OAuth
- 구글 로그인 후 닉네임 없으면 닉네임 설정 모달 표시
- 회원가입은 외부 사이트(`majo-newsletter.vercel.app/signup`)로 연결

**뉴스레터 구독 폼:** 백엔드 없음 — `localStorage`에 `manzo_subscribed` 키 저장으로 상태 유지.
실제 이메일 발송 시스템과 연동되어 있지 않음.

---

## 개발 워크플로우

### 콘텐츠 추가 (분석 글)

1. `index.html`의 `ARTICLES` 배열에 새 객체 추가 (line 406 근처)
2. 동일 내용을 `article.html`의 `ARTICLES` 배열에도 추가 (line 165 근처)
3. `index.html`의 `CHART_DATA`에 같은 `id`로 차트 설정 추가 (line 474 근처)
4. 같은 차트 설정을 `article.html`의 `CHART_DATA`에도 추가

### 콘텐츠 추가 (뉴스레터)

1. `index.html`의 `NEWSLETTERS` 배열에 추가 (line 430 근처)
2. `archive.html`의 `NEWSLETTERS` 배열에도 추가 (line 143 근처)

### 마켓스코프 데이터 업데이트

`market-scope-data.json`을 직접 편집하여 `current`와 `history` 배열 갱신 후 커밋.
커밋 메시지 패턴: `data: 마켓스코프 업데이트 YYYY-MM-DD`

### 뉴스 소스 추가/변경

`index.html` line 1015–1031의 `SOURCES_KR` 또는 `SOURCES_INTL` 배열 수정.
- RSS URL은 `/api/news.js`를 통해 프록시되므로 CORS 제약 없음
- 차단된 소스는 대안 소스로 교체 (git 히스토리 참조: 여러 차례 교체 이력 있음)

### 배포

```bash
git add <파일>
git commit -m "feat|fix|data: 변경 내용 설명"
git push -u origin <branch>
```

빌드 단계 없음. Vercel이 자동으로 정적 파일을 서빙하고 `/api/*.js`를 Serverless Function으로 배포.

---

## 환경 변수

Vercel 프로젝트 설정에서 관리:

| 변수명 | 용도 | 필수 |
|--------|------|------|
| `NAVER_CLIENT_ID` | 네이버 검색 API 클라이언트 ID | `/api/naver-news.js` 동작에 필수 |
| `NAVER_CLIENT_SECRET` | 네이버 검색 API 클라이언트 시크릿 | `/api/naver-news.js` 동작에 필수 |

로컬 개발 시: `api/` 폴더 내 함수는 Vercel CLI (`vercel dev`)로 실행하거나, 직접 Node.js로 테스트.

---

## 커밋 메시지 규칙

```
feat: 새로운 기능 추가
fix: 버그 수정
data: 데이터 파일(market-scope-data.json 등) 업데이트
debug: 임시 디버그 코드 (PR에 포함 지양)
```

영어와 한국어 혼용 가능. 제목은 간결하게, 변경 대상을 명시.

---

## 주의사항 & 함정

1. **`data.js`는 미사용** — 어떤 HTML도 `<script src="data.js">`를 포함하지 않는다. 내용 변경해도 사이트에 반영되지 않음.

2. **CSS는 각 HTML 파일에 중복** — `style.css`가 아닌 각 HTML의 `<style>` 블록이 주력이다. CSS 변경 시 세 HTML 파일 모두 확인.

3. **캔들 차트는 실제 데이터가 아님** — seeded RNG로 생성된 의사 데이터. `type:"candle"` 차트의 `seed`와 `startPrice`를 바꾸면 다른 패턴이 생성됨.

4. **구독 폼은 실제 이메일을 저장하지 않음** — `localStorage`에만 기록. 실제 구독 처리 시스템 추가 필요 시 Supabase 또는 외부 서비스 연동 필요.

5. **author.jpg는 HTML 내 base64 내장** — `index.html` 약 350라인 근처의 `<img src="data:image/jpeg;base64,...">`. 필자 사진 교체 시 base64 인코딩 후 해당 src 값 교체.

6. **Cache-Control 설정** — API 함수들은 `s-maxage=300, stale-while-revalidate=600` (5분 캐시, 10분 재사용)을 반환. 실시간성이 필요한 수정 시 이 값 조정.

7. **`/api/news.js`의 `debug=1` 파라미터** — 응답에 `_raw: xml.slice(0,800)`을 포함해 파싱 디버깅에 활용 가능. 프로덕션에서는 제거 불필요 (클라이언트가 호출 안 함).
