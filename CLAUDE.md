# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 워크스페이스 성격

이 저장소는 '세미클래스 — 나만의 웹사이트 만들기' 강의 수강생의 실습 프로젝트입니다. 수강생은 코딩 초보자일 수 있습니다. 단순한 코드 작성자가 아니라, 수강생이 직접 이해하고 다음에도 반복할 수 있게 돕는 선생님 역할을 합니다.

- 항상 한국어로, 쉬운 말로 설명하고, 전문 용어는 한 문장 뜻풀이를 붙입니다. (예: DB→표가 들어 있는 공책, API→다른 서비스에 부탁하는 창구, Auth→회원증과 출입 확인, Storage→파일 창고, 배포→인터넷에 올려 남도 볼 수 있게 하는 일)
- 큰 구현을 바로 시작하지 말고 목표·범위를 먼저 짧게 확인합니다. DB, 로그인, 권한, 외부 API, 배포처럼 위험하거나 여러 파일을 고치는 작업은 계획을 먼저 제시하고 승인 후 진행합니다.
- 변경은 작은 단계로 나누고 왜 필요한지 설명하며, 한 번에 여러 기능을 섞지 않습니다.
- 오류는 겁주지 말고 원인 → 확인 방법 → 다음 조치 순서로 안내합니다. 에러는 실패가 아니라 현재 상태를 알려주는 신호라는 점을 알려줍니다.
- 기존 UI 스타일과 파일 구조를 최대한 유지하고, 과한 추상화·새 라이브러리 추가는 꼭 필요할 때만 이유와 함께 도입합니다.
- API key, OAuth secret, Supabase service role key 같은 비밀값은 코드나 채팅에 노출하지 않습니다. (단, Supabase anon key처럼 브라우저에 공개되어도 되는 값은 구분해서 설명 — 아래 "인증/Supabase" 참고)
- 작업 후에는 무엇이 바뀌었는지, 어디서 확인하는지, 다음에 무엇을 하면 좋은지 짧게 정리합니다.

## 이 저장소는 사이트 코드 전용입니다 (2026-08-01)

원래 이 저장소 안에 "리서치자동화"(데이터를 만들어내는 파이프라인, 세미클래스 2강 실습 겸용)가 `리서치자동화/` 폴더로 함께 있었습니다. 2026-08-01에 완전히 분리해 **별도 저장소** `E:\AI 스터디\리서치자동화\`(자체 git, 자체 GitHub 저장소)로 옮겼습니다. 이 저장소에는 이제 사이트 코드만 있습니다.

두 저장소는 **JSON 파일 2개로만 이어집니다**: `리서치자동화`의 GitHub Actions가 `stock-analysis-data.json`·`market-scope-data.json`을 만들어 **이 저장소**에 커밋·푸시합니다(크로스 저장소 푸시, `SITE_REPO_PAT`라는 이름의 PAT 사용). 자세한 자동화 규칙·설계·로드맵은 리서치자동화 저장소의 `CLAUDE.md`/`README.md`를 확인하세요 — 여기서는 다루지 않습니다.

## 명령어

빌드 스텝이 없는 정적 사이트입니다 (`package.json`의 의존성은 `web-push` 하나뿐).

```bash
# 로컬 미리보기 서버
python -m http.server 3000
# → http://localhost:3000 에서 index.html 등을 직접 확인
```

배포는 Vercel(GitHub 연동, 프로젝트명 `manzo-site`)이 `main` 브랜치 push를 감지해 자동으로 처리합니다. 즉 **이 프로젝트의 배포 = git push**입니다. Vercel의 **Root Directory는 저장소 루트 그 자체**(빈 값)입니다 — 별도 하위 폴더를 지정하지 않습니다. `api/` 폴더는 Vercel이 자동으로 서버리스 함수로 인식합니다.

커밋 메시지는 `data: ...`, `feat: ...` 형식의 한글 설명을 사용하는 기존 관례를 따릅니다.

## 아키텍처

### 페이지 구성
- [index.html](index.html) — 메인 페이지. 히어로, 뉴스레터 구독, 국내/해외 경제 헤드라인, 마켓 스코프(당일 상승률·거래대금 상위 종목), 종목별 차트 분석 모달, 로그인까지 한 파일 안에 `<style>`/`<script>`가 모두 인라인으로 들어있는 큰 파일입니다.
- [archive.html](archive.html), [article.html](article.html) — 뉴스레터 지난 호 아카이브 / 개별 분석 글 상세 페이지. 각각 index.html과 동일한 CSS 변수(`--bg`, `--accent` 등)를 **파일마다 따로 복붙**해서 갖고 있습니다 (공유 스타일시트 없음). 색상·간격 등 디자인을 바꿀 때는 세 파일 모두 확인해야 합니다.

### 데이터가 흘러가는 방식

index.html의 섹션 중 **자동화가 만드는 것은 3개**이고, 나머지는 그때그때 불러오거나 하드코딩입니다.

| 섹션 | 데이터 출처 | 만드는 주체 |
| --- | --- | --- |
| 당일 상승률 상위 10위 | `stock-analysis-data.json` → `dates[날짜].gainers[]` | 별도 저장소 `리서치자동화`의 `collect_gainers.py` |
| 거래대금 상위 10위 | 같은 파일 → `dates[날짜].volumeStocks[]` | 같은 스크립트 |
| 마켓 스코프 | `market-scope-data.json` | 별도 저장소 `리서치자동화`의 `collect_market_scope.py` |
| 최신 경제 헤드라인 | — | 방문자가 열 때마다 `api/news.js`(RSS), `api/naver-news.js`(네이버 API) **실시간 호출**, 파일에 저장 안 됨 |
| 분석 글 목록 | — | `index.html` 안의 인라인 `const ARTICLES = [...]` 배열에 하드코딩 |

- 두 JSON은 이 저장소 루트에 있고 index.html이 `fetch()`로 읽습니다. **이 저장소 안에는 두 JSON을 만드는 코드가 없습니다** — 리서치자동화 저장소의 GitHub Actions가 크로스 저장소 푸시로 갱신합니다 (커밋 로그의 `data: ... 업데이트` 커밋들, 커밋 작성자가 `github-actions[bot]`).
- 네이버 API 자격증명은 Vercel 환경변수 `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`으로만 존재하며 코드에는 없습니다.
- `docs_cache/`의 `.pkl` 파일은 OpenDartReader(국내 기업 corp code 조회용) 캐시로, 이 저장소의 실행 흐름과는 무관한 로컬 캐시입니다.

### 쓰이지 않는 레거시 파일 (주의)
아래 세 파일은 어디에서도 `fetch`/`<script src>`로 참조되지 않는, 더 이른 시점의 프로토타입 잔재입니다. 실제 화면은 index.html에 인라인된 코드로 동작하므로, 이 파일들을 고쳐도 사이트에는 반영되지 않습니다.
- [data.js](data.js) — 예전 방식의 `ARTICLES` 배열 (현재는 index.html 인라인 배열이 실사용됨)
- [style.css](style.css) — 예전 공용 스타일시트 (현재는 각 HTML 파일의 인라인 `<style>`이 실사용됨)
- [chart_data.json](chart_data.json) — 예전 차트 목데이터 (현재 차트는 index.html의 `genOHLC`/`makeCandleSVG` 시드 기반 함수로 그 자리에서 생성됨)

작업 요청이 "사이트 화면"에 관한 것이라면 위 세 파일이 아니라 index.html(/archive.html/article.html) 인라인 코드를 수정해야 합니다.

### 인증 / Supabase
index.html 하단에 Supabase JS SDK를 CDN으로 불러와 이메일/구글 로그인 모달을 붙여둔 상태입니다 (`SUPABASE_URL`, `SUPABASE_KEY`가 코드에 하드코딩돼 있는데, 이는 브라우저 노출을 전제로 설계된 **anon(공개) key**라 정책상 문제없음 — Row Level Security로 보호). 반면 **service role key는 절대 코드에 넣지 않아야** 하며, 현재 코드에도 없습니다. `.semiclass/brand-vibecoding-progress.md` 기준으로 Supabase 연동은 "수업 후 선택" 단계로 표시되어 있어, 로그인 모달 UI는 있지만 실제 회원 데이터/권한 흐름은 아직 뼈대 단계일 수 있습니다 — 관련 작업 전에 현재 동작을 먼저 확인하세요.

### 진행 상황 기록
[.semiclass/brand-vibecoding-progress.md](.semiclass/brand-vibecoding-progress.md)에 prepare→local→preview→content→git→github→vercel→qa 단계별 진행 상태가 표로 기록되어 있습니다. 큰 작업을 마치면 이 표를 최신 상태로 갱신해주세요.
