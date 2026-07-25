# 마켓 스코프 파이프라인 정리 (2026-07-25)

## 배경 (역설계 결과)

`market-scope-data.json`을 채우는 자동화가 최소 3갈래로 겹쳐 있었다.

| 경로 | 트리거 | 무엇을 하나 | 상태 |
|---|---|---|---|
| A. 외부 Telethon+Ollama | Windows 작업 스케줄러 `ManzoMarketScope`(매일 05:00) → `C:\Users\hahaa\manzo_daily.bat` → 별도 폴더의 `daily_report.py`(Telethon 로그인 + 로컬 Ollama AI) | 텔레그램 13채널 원문 수집 → 로컬 AI로 종목/이슈 추출 → `market-scope-data.json` 갱신 → git push. 실행 후 `shutdown /s /t 60`으로 PC 자동 종료 | **17일째 조용히 실패 중.** 산출물(`monitor.db`, `reports/`)이 2026-07-08 이후 갱신 없음. 그런데 Task Scheduler의 `LastTaskResult`는 매일 `0`(성공)으로 찍힘 — `manzo_daily.bat`의 마지막 명령이 `shutdown`이라, 그 앞의 파이썬이 실패해도 배치파일 자체는 항상 성공으로 끝나기 때문 |
| B. Cowork 뉴스 대체 | Cowork 자체 예약작업 `market-scope-daily-update`(매일 05:00경) | 텔레그램 접근 권한이 없어 뉴스 헤드라인 검색으로 대체 → 같은 `market-scope-data.json` 갱신 → git commit/push | **살아있음.** 오늘(07-25)까지 계속 커밋되고 있음 |
| C. 저장소 내 스크립트 | 스케줄 없음 (수동 실행 추정) | `scripts/collect_market_scope.py` — A와 같은 13채널을 Telethon 로그인 없이 단순 HTTP(`t.me/s/채널`)로 스크래핑, 로컬 Ollama 대신 Gemini 사용 | 코드는 최신이고 A보다 구조가 단순(로그인·로컬 AI 서버 불필요)하지만 어디에도 연결 안 돼 있음 |

**실제로 벌어지고 있던 일**: `market-scope-data.json`의 `channel_count` 필드를 날짜별로 비교하면 두 가지 "지문"이 번갈아 나타난다 — `channel_count: 13`(텔레그램 계열, message_count 200~370)과 `channel_count: 20~27`(뉴스 계열, message_count 40~60). 07-20, 07-23 등 여러 날짜에서 **같은 날 두 번 덮어써진 흔적**이 있고, 나중에 실행된 쪽이 그날의 최종 데이터로 남는다. 즉 사이트에 보이는 마켓 스코프 데이터 품질이 그날그날 어느 자동화가 이겼는지에 따라 무작위로 널뛰고 있었다.

## 결정 사항 (사용자 승인 완료)

1. **텔레그램 13채널 신호를 메인으로 유지**하되, **뉴스 검색 신호를 추가로 병합**한다 (둘 중 하나를 버리는 게 아니라 합친다).
2. 병합 대상 스크립트는 **저장소 내 `scripts/collect_market_scope.py`(경로 C)를 확장**한다 — Telethon 로그인이나 로컬 Ollama 서버가 필요 없어 A보다 신뢰성이 높고, 이미 이 저장소가 관리하는 코드이기 때문.
3. 뉴스 검색은 **이미 배포된 `/api/naver-news` 프록시를 그대로 재사용**한다 — 로컬에 새 비밀값(NAVER_CLIENT_ID/SECRET)을 둘 필요가 없다 (그 값들은 Vercel 환경변수로만 존재하며 이 저장소 정책상 코드/로컬에 노출하지 않는다).
4. 실행 트리거는 **Windows 작업 스케줄러**(경로 A와 같은 새벽 5시대)를 계속 쓰되, **17일째 실패를 가리고 있던 구조적 문제(배치파일 종료 코드가 항상 성공)를 고친다**.
5. **실행 후 PC 자동 종료(`shutdown`)는 넣지 않는다** — 같은 날 오후 4시 `ManzoGainers_Daily`가 돌려면 PC가 켜져 있어야 하기 때문.
6. 외부 `daily_report.py`(경로 A, Telethon+Ollama)는 스케줄에서 더 이상 호출하지 않는다. 코드 자체는 이 저장소 밖(별도 폴더)이라 손대지 않는다.
7. Cowork `market-scope-daily-update`(경로 B)는 기능이 흡수되므로 **사용자가 직접 Cowork 쪽에서 비활성화**한다.

## 데이터 소스 병합 설계

**기존 (유지)**: `scripts/collect_market_scope.py`가 13개 텔레그램 채널을 `https://t.me/s/채널명`으로 스크래핑 → 메시지 본문의 `<a>` 태그(네이버 증권 링크)에서 종목명 후보 추출 → 본문 전체에서 언급 횟수/채널 수 집계(`build_stock_stats`) → Gemini로 시장 테마·이슈 탐지(`detect_issues`) → `score = 언급수 + 채널수×2`로 랭킹.

**신규 (추가)**: 고정된 시황 키워드(예: `"특징주"`, `"급등주"` 등 소수) 각각으로 `/api/naver-news?query=...` 프록시를 호출 → 반환된 헤드라인(키워드당 최신 3건)을 모아 Gemini로 종목/이슈명 추출(기존 `detect_issues`와 비슷한 프롬프트 재사용) → 추출된 이름을 기존 `stock_stats`/`issue_stats`에 병합:
- 이미 텔레그램에서 발견된 이름이면, `channels` 집합에 `"naver_news"`라는 원소를 추가하고 해당 뉴스 기사를 그 이름의 `articles`에 합친다 (기존 `score` 공식이 그대로 자동으로 반영 — 뉴스도 "채널 하나"로 취급).
- 텔레그램에서 못 찾은 새 이름이면, `channels = {"naver_news"}`인 새 항목으로 추가한다.

**명시적 한계**: `/api/naver-news`는 키워드당 최신 3건만 주는 검색 API라, Cowork가 하던 것처럼 폭넓은 "오늘의 트렌드" 스캔이 아니다. 텔레그램 신호를 보완하는 약한 신호로 취급하고, 완전한 대체재로 기대하지 않는다.

## 실행 신뢰성 수정

**문제**: 지금 `manzo_daily.bat`은 `python daily_report.py` 다음 줄이 `shutdown /s /t 60`이라, 파이썬이 어떤 이유로 실패해도 배치파일의 최종 종료 코드는 `shutdown`의 성공 여부만 반영한다. Windows Task Scheduler는 그래서 17일 연속 "성공(0)"으로 기록했지만 실제로는 아무 데이터도 안 만들어지고 있었다.

**수정**: 새 실행 스크립트(배치파일 또는 PowerShell 스크립트)는
1. `python scripts/collect_market_scope.py` 실행 직후 `%ERRORLEVEL%`(또는 PowerShell `$LASTEXITCODE`)을 즉시 캡처해 배치파일 자신의 종료 코드로 그대로 반영한다.
2. 표준출력/표준에러를 로그 파일로 남긴다 (예: `logs/market-scope-YYYY-MM-DD.log`) — 지금은 스케줄러로 돌 때 출력이 어디에도 안 남아 실패를 알아챌 방법이 없었다.
3. `shutdown` 명령을 넣지 않는다 (위 결정 사항 5).

## 정리 대상 정리

| 대상 | 조치 | 되돌리는 법 |
|---|---|---|
| `ManzoMarketScope`(Windows 작업) | 새 실행 스크립트(`scripts/collect_market_scope.py` 호출)를 가리키도록 액션 교체 | 원래 액션(`manzo_daily.bat`)으로 복원 |
| 외부 `daily_report.py` 경로 | 스케줄에서 제거만, 코드 손 안 댐 | `ManzoMarketScope` 액션을 원래대로 되돌리면 재개 |
| Cowork `market-scope-daily-update` | 사용자가 Cowork UI에서 직접 비활성화 (이 세션은 접근 불가 — 상승률 파이프라인 정리 때와 동일한 제약) | Cowork UI에서 재활성화 |
| `PreventSleep_Start`/`PreventSleep_End`(Windows 작업) | 그대로 유지 (새벽 5시 실행을 위해 계속 필요) | 해당 없음 |

## 에러 처리

- 텔레그램 채널 스크래핑 중 일부 채널이 실패해도 그 채널만 건너뛰고 계속 진행 (기존 `scrape_channel`의 동작을 그대로 유지)
- `/api/naver-news` 호출이 실패(타임아웃, 500 등)해도 뉴스 신호 없이 텔레그램 결과만으로 파이프라인을 계속 진행한다 — 뉴스 병합은 파이프라인 전체를 막는 필수 단계가 아니다
- Gemini 429(rate limit)는 기존 `call_gemini_with_retry`(혹은 동등 로직) 재사용

## 테스트

- 과거/오늘 날짜를 지정해 스크립트를 직접 실행하고(`--date` 옵션, 기존에 이미 지원) `market-scope-data.json`에 올바른 구조(뉴스 출처가 반영된 항목 포함)로 저장되는지 확인한다.
- 이 스크립트는 텔레그램·네이버 뉴스·Gemini라는 외부 API에 의존하는 통합 스크립트라, 저장소의 기존 관례(`collect_gainers.py` 등)와 마찬가지로 유닛 테스트보다 실행 결과 검증 위주로 확인한다.
- 새 실행 스크립트(배치/PowerShell)는 의도적으로 파이썬을 실패시켜(예: 잘못된 인자) 종료 코드가 0이 아니게 전달되는지, 로그 파일이 실제로 남는지 확인한다.

## 이번 범위에서 제외

- Vercel 서버리스로의 이전(브레인스토밍 중 "방법 2"로 논의됐던 대안)은 이번 범위에 넣지 않는다. 이번 정리가 안정화된 뒤 필요하면 별도로 검토한다.
- 상승률 파이프라인(이미 별도로 정리 완료 — [2026-07-25-gainers-automation-cleanup-design.md](2026-07-25-gainers-automation-cleanup-design.md) 참고)은 이번 변경에 포함하지 않는다.
