# 만조그룹 2차

만조리서치(만조인베스트) 사이트와, 그 사이트에 들어갈 데이터를 만드는 자동화를 함께 두는 저장소입니다. 2026-08-01부터 **기능에 따라 두 폴더로 나뉘어** 있습니다.

| 폴더 | 무엇을 하는 곳 | 여기서 여는 파일 |
| --- | --- | --- |
| [웹페이지관리/](웹페이지관리/) | 사이트 자체 — 화면, 뉴스 API, 로그인, 배포 | `index.html`, `api/`, `style.css` |
| [리서치자동화/](리서치자동화/) | 데이터를 만들어내는 파이프라인 | [리서치자동화/README.md](리서치자동화/README.md), `scripts/`, `dashboard.html` |

## 두 폴더는 어떻게 이어지나

```
리서치자동화/scripts/collect_gainers.py       ─┐
리서치자동화/scripts/collect_market_scope.py  ─┤ 만들어서 씀
                                               ↓
웹페이지관리/stock-analysis-data.json
웹페이지관리/market-scope-data.json
                                               ↓ 읽어서 그림
웹페이지관리/index.html
  ├ 당일 상승률 상위 10위   ← gainers[]
  ├ 거래대금 상위 10위      ← volumeStocks[]
  └ 마켓 스코프             ← market-scope-data.json
```

접점은 **JSON 파일 2개뿐**입니다. 나머지 섹션(경제 헤드라인·분석 글·로그인)은 자동화와 무관합니다.

자동화 결과물이 `웹페이지관리/` 아래에 사는 이유는, Vercel이 **Root Directory(`웹페이지관리`) 아래 파일만** 서빙하기 때문입니다.

## 실행

```bash
# 사이트 로컬 미리보기
python -m http.server 3000 --directory 웹페이지관리
```

```bash
# 자동화 대시보드 다시 만들기
node 리서치자동화/.automation/dashboard/refresh-dashboard.mjs 리서치자동화
```

자동화는 평소 [.github/workflows/](.github/workflows/)의 GitHub Actions가 알아서 돌립니다(상승률 매일 16:00 KST, 마켓 스코프 매일 05:00 KST). 워크플로 파일은 GitHub 규칙상 저장소 루트에 있어야 해서 두 폴더 밖에 둡니다.

## 루트에 남은 것

`CLAUDE.md`(작업 규칙), `.env.local`(공용 API 키, git 제외), `MANZO/`(프로젝트 지식 노트), `docs/`, `docs_cache/`.
