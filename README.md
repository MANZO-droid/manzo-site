# 만조인베스트 웹페이지 관리

만조인베스트(만조그룹회장) 사이트의 **코드 전용** 저장소입니다. 예전에는 이 저장소 이름이 `만조그룹 2차`였고, 안에 데이터 자동화 폴더(`리서치자동화/`)까지 함께 있었지만, 2026-08-01에 구조가 한 번 더 정리됐습니다.

- 이 저장소(`만조인베스트 웹페이지 관리`)에는 **사이트 코드만** 있습니다. `index.html`, `archive.html`, `article.html`, `api/` 등 파일이 폴더 구분 없이 저장소 루트에 바로 있습니다.
- 데이터를 만들어내는 자동화는 **완전히 별도의 저장소**(`리서치자동화`, 자체 git·자체 GitHub)로 옮겨졌습니다. 이 저장소 안에는 `리서치자동화/` 같은 폴더가 없습니다 — 하위 폴더가 아니라 나란히 있는 다른 프로젝트입니다.

## 두 저장소는 어떻게 이어지나

```
[리서치자동화 저장소]                    [만조인베스트 웹페이지 관리 저장소]
collect_gainers.py (Groq) ──┐
collect_market_scope.py (Gemini) ─┤
        │  GitHub Actions가 Supabase에 직접 씀
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase (nxvpipgvcrfkujbvjjak)                             │
│  daily_gainers · volume_stocks · market_scope_reports        │
└─────────────────────────────────────────────────────────────┘
        │ anon key로 읽기 전용 조회
        ▼
api/top-gainers.js, api/market-scope.js
        │
        ▼
index.html — 당일 상승률 상위 10위 · 거래대금 상위 10위 · 마켓 스코프
```

두 저장소는 **git으로 이어지지 않고, Supabase 하나로만 이어집니다.** 이 저장소(사이트) 안에는 Supabase에 쓰는 코드가 하나도 없습니다 — 전부 읽기 전용입니다.

**2026-08-02 정리**: 원래 이 저장소에도 `api/cron-update-gainers.js`(Vercel Cron, 키움 API 직접 호출)라는 자체 쓰기 코드가 있었는데, 리서치자동화 쪽이 이미 같은 표를 채우고 있어 **같은 데이터에 두 곳이 동시에 쓰는 충돌 요인**이었습니다. 이 코드와 관련 파일(`api/_kiwoom.js`, `lib/krx-calendar.js`, `scripts/run-pipeline.js`·`seed-test-row.js`·`test-kiwoom.js`)을 전부 삭제했습니다. 이제 상승률 Top10·거래대금·마켓스코프·상승이유·차트분석 전부 `리서치자동화` 저장소가 만들어 Supabase에 씁니다.

옛 `stock-analysis-data.json`·`market-scope-data.json`도 같은 날 삭제했습니다 — 삭제 전 Supabase에 같은(또는 더 많은) 데이터가 이미 들어가 있는 걸 직접 대조해 확인했습니다.

경제 헤드라인·분석 글·로그인 섹션은 이 자동화와 무관합니다 (헤드라인은 방문 시 실시간 API 호출, 분석 글은 `index.html` 안 하드코딩 배열).

## 실행

```bash
# 사이트 로컬 미리보기 (저장소 루트에서 그대로 실행 — 하위 폴더 지정 불필요)
python -m http.server 3000
# → http://localhost:3000
```

배포는 Vercel(GitHub 연동)이 `main` 브랜치 push를 감지해 자동으로 처리합니다. Vercel의 Root Directory는 저장소 루트 그 자체입니다.

## GitHub 저장소 이름 / Vercel 프로젝트 이름에 대해

로컬 폴더 이름은 `만조인베스트 웹페이지 관리`로 바뀌었지만, **GitHub 저장소 이름(`manzo-site`)과 Vercel 프로젝트 이름(`manzo-site`)은 지금 그대로 유지 중**입니다. 로컬 폴더 이름과 GitHub/Vercel 이름이 반드시 같아야 하는 것은 아니라서, 지금 당장 바꾸지 않아도 배포·자동화는 정상 동작합니다.

나중에 이름을 통일하고 싶다면 아래처럼 하면 됩니다 (사이트 동작에는 영향 없는, 순전히 이름 정리용 작업입니다).

- GitHub: 저장소 페이지 → Settings → Repository name에서 이름 변경. 변경 후에도 기존 URL로 접속하면 자동으로 새 이름으로 리다이렉트되지만, 로컬 git의 `origin` 주소는 새로 맞춰주는 것이 좋습니다.
- Vercel: 프로젝트 → Settings → General → Project Name에서 이름 변경. 배포 도메인(`manzo-site.vercel.app` 등)은 별도 설정이라 프로젝트 이름을 바꿔도 자동으로 같이 바뀌지는 않습니다.

## 루트에 있는 것

`CLAUDE.md`(작업 규칙), `README.md`(이 파일), `.env.local`(공용 API 키, git 제외), `index.html`/`archive.html`/`article.html`(사이트 페이지), `api/`(읽기 전용 서버리스 함수), `MANZO/`(프로젝트 지식 노트), `notes/`, `docs/`, `docs_cache/`, `.semiclass/`(강의 진행 기록).
