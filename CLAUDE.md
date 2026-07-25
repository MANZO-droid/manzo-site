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

## 명령어

빌드 도구나 패키지 매니저가 없는 순수 정적 사이트입니다 (`package.json` 없음, `npm install` 불필요).

```bash
# 로컬 미리보기 서버 (.claude/launch.json에 등록된 방식)
python -m http.server 3000
# → http://localhost:3000 에서 index.html 등을 직접 확인
```

배포는 Vercel(GitHub 연동, 프로젝트명 `manzo-site`)이 `main` 브랜치 push를 감지해 자동으로 처리합니다. 별도의 `vercel.json`이나 빌드 스텝은 없으며, `api/` 폴더는 Vercel이 자동으로 서버리스 함수로 인식합니다. 즉 **이 프로젝트의 배포 = git push**입니다.

커밋 메시지는 `data: ...`, `feat: ...` 형식의 한글 설명을 사용하는 기존 관례를 따릅니다.

## 아키텍처

### 페이지 구성
- [index.html](index.html) — 메인 페이지. 히어로, 뉴스레터 구독, 국내/해외 경제 헤드라인, 마켓 스코프(당일 상승률·거래대금 상위 종목), 종목별 차트 분석 모달, 로그인까지 한 파일 안에 `<style>`/`<script>`가 모두 인라인으로 들어있는 큰 파일입니다.
- [archive.html](archive.html), [article.html](article.html) — 뉴스레터 지난 호 아카이브 / 개별 분석 글 상세 페이지. 각각 index.html과 동일한 CSS 변수(`--bg`, `--accent` 등)를 **파일마다 따로 복붙**해서 갖고 있습니다 (공유 스타일시트 없음). 색상·간격 등 디자인을 바꿀 때는 세 파일 모두 확인해야 합니다.

### 데이터가 흘러가는 방식
- `market-scope-data.json`, `stock-analysis-data.json`은 index.html이 `fetch()`로 직접 읽어 마켓 스코프/종목 분석 섹션을 그립니다. 이 JSON들은 **이 저장소 안에 생성 스크립트가 없고**, 외부에서 (Gemini 등으로) 만든 값을 그대로 파일에 덮어써서 커밋하는 방식으로 갱신됩니다 (커밋 로그의 `data: ... 업데이트` 커밋들 참고). 즉 "코드"가 아니라 "데이터 스냅샷"을 갱신하는 작업입니다.
- 아티클(분석 글) 목록은 index.html 493번째 줄 근처의 인라인 `const ARTICLES = [...]` 배열로 관리됩니다.
- 국내/해외 뉴스 헤드라인은 `api/news.js`(RSS 프록시)와 `api/naver-news.js`(네이버 뉴스 검색 API)를 프론트에서 호출해 채웁니다. 네이버 API 자격증명은 Vercel 환경변수 `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`으로만 존재하며 코드에는 없습니다.
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

## 업무자동화 학습 공간 (2강)

이 저장소는 '세미클래스 — 나만의 웹사이트 만들기' 강의 프로젝트인 동시에, "AI 업무자동화" 강의의 개인 실습 공간이기도 합니다. 수강생의 1강 설계도([design/automation-blueprint.md](design/automation-blueprint.md))에서 자동화 대상을 이 저장소의 '당일 상승률 상위 10위' 파이프라인(마켓 스코프 자동화, market-scope-data.json/stock-analysis-data.json)으로 직접 지정했기 때문에, 별도 폴더가 아니라 이 루트에 함께 둡니다.

- 전체 안내는 [README.md](README.md), 폴더별 역할은 [02-reference/workspace-file-guide.md](02-reference/workspace-file-guide.md)를 확인하세요.
- 진행 상태는 [progress/roadmap.md](progress/roadmap.md) / [progress/roadmap.html](progress/roadmap.html)이 정본입니다. 증거 없이 완료로 바꾸지 않습니다.
- "입·출력 규격 검증을 진행해줘" 또는 "목 입력을 만들어줘" 요청을 받으면, 먼저 `skills/`(사람이 읽는 정본)와 `.claude/skills/`(Claude Code가 인식하는 투영본)의 `semiclass-input-output-spec-review`/`semiclass-mock-input-generator` SKILL.md를 적용합니다. 스킬이 없거나 찾을 수 없으면 일반 답변으로 대신하지 말고 누락된 경로를 그대로 알려주세요.
- 확정된 규칙은 `context/README.md`, 아직 확정 전인 질문·후보는 `inbox/lesson-02.md`에 있습니다. 한 번에 다음 행동 하나만 안내하고, `progress/roadmap.md`의 회차 순서를 따르세요.
- 위 워크스페이스 자체는 어려운 말 대신 비유와 작은 예시로 안내하는 학습용 공간입니다. 이 절이 다루는 파일들(README.md, skills/, design/, progress/ 등) 밖의 사이트 코드 작업에는 이 문서의 다른 절(워크스페이스 성격, 아키텍처 등)을 그대로 따르세요.
