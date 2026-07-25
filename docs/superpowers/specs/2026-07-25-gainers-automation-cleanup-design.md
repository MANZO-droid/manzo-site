# 상승률 상위 10위 자동화 교통정리 (2026-07-25)

## 배경 (역설계 결과)

"상승률 상위 10위 + 종목 분석"을 채우는 자동화가 3~4갈래로 중복돼 있었다.

| 경로 | 트리거 | 무엇을 하나 | 상태 |
|---|---|---|---|
| A. 네이버+Gemini | Windows 작업 스케줄러 `ManzoGainers_Daily`(평일 16:00) / `ManzoGainers_Weekly`(토 16:00) → `scripts/collect_gainers.py` | 네이버 크롤링 + Gemini 분석 → `stock-analysis-data.json` 갱신 → git push | **살아있음.** 오늘(7/25)까지 계속 관리 중이며 사이트가 실제로 읽는 유일한 데이터 소스 |
| B. 키움+Supabase | Vercel Cron(`vercel.json`, 매일 16:00 KST) → `api/cron-update-gainers.js` | 키움 API 순위/시세/OHLCV → Supabase `daily_gainers` upsert | **죽어있음.** `daily_gainers` 최신 행이 2026-07-12에서 멈춤 → 13일 연속 실패. 원인은 키움 "지정단말기" 인증(에러 8050), Vercel 서버리스 아웃바운드 IP가 매번 바뀌는 게 원인으로 추정. 사용자는 아직 키움 고객센터에 문의하지 않음 |
| C. 레거시 중복 | Windows 작업 스케줄러 `ManzoStockAnalysis`(매일 16:30) → 외부 폴더의 `daily_stock_analysis.py` | A와 완전히 동일한 목적(상승률+거래대금 상위10, `stock-analysis-data.json` 갱신, git push) | **레거시.** 마지막 수정 2026-07-07 — `collect_gainers.py`(첫 커밋 7/17)가 만들어지기 전의 구버전. A와 30분 간격으로 같은 파일에 git push를 시도해 충돌 위험이 있음 |
| D. Cowork 예약작업 `rise-reason-daily-analysis` | Cowork 자체 스케줄러(매일 16:30경) | B가 채워야 할 Supabase `daily_gainers`를 읽어 `rise_reason` 컬럼을 PATCH | B가 죽어있어 매일 "오늘 데이터 없음"으로 허탕만 침 |

부가로 `scripts/enrich_gainers.py`, `scripts/audit_volume_gaps.py`는 스케줄에 걸려있지 않은 수동 보조 스크립트로, 이번 정리 대상이 아니다.

## 결정 사항 (사용자 승인 완료)

1. **A(네이버+Gemini, `collect_gainers.py` + `ManzoGainers_Daily/Weekly`)를 공식 메인 파이프라인으로 확정.** 손대지 않는다.
2. **C(`ManzoStockAnalysis` + `daily_stock_analysis.py`)를 비활성화.** 코드/작업은 삭제하지 않고 "끔" 상태로만 전환 (되돌릴 수 있게).
3. **B(Vercel Cron)를 일단 보류: 코드는 남기고 스케줄만 끈다.** `api/cron-update-gainers.js`, `api/_kiwoom.js`는 그대로 두어 나중에 키움 지정단말기 문제가 풀리면 스케줄만 다시 켜서 재개할 수 있게 한다. `vercel.json`의 `crons` 항목을 제거한다.
4. **D(Cowork `rise-reason-daily-analysis`)는 B가 켜지기 전까지 의미가 없으므로 사용자가 Cowork 쪽에서 직접 비활성화(또는 일시정지)한다.** 이 세션의 도구로는 Cowork 예약작업에 접근할 수 없어 Claude Code가 대신 끌 수 없음 — 안내만 제공.

## 실행 범위와 제약

- **Windows 작업 스케줄러**: 이 세션(PowerShell)에서 직접 `Disable-ScheduledTask`로 끌 수 있다. `Unregister`(완전 삭제)가 아니라 `Disable`을 써서 필요하면 `Enable-ScheduledTask`로 즉시 되돌릴 수 있게 한다.
- **`vercel.json` 수정**: 로컬 파일 수정 + 커밋까지는 이 세션에서 가능. 다만 이 저장소는 "git push = 배포"이므로, **push는 사용자에게 먼저 확인받은 뒤 실행**한다 (프로덕션 크론 스케줄이 실제로 꺼지는 시점이라 되돌리기엔 재배포가 필요함).
- **Cowork 예약작업**: 이 세션은 Cowork의 스케줄러에 접근 권한이 없다(`CronList`/`scheduled-tasks` 도구 모두 비어 있음 — 별도 계정/제품). 사용자가 Cowork UI에서 직접 꺼야 한다. 어디서 끄는지만 안내한다.

## 문서 갱신

- `MANZO/04 - 데이터 파이프라인.md`: 키움 경로 상태를 "13일째 실패, 스케줄 비활성화"로, `ManzoStockAnalysis`를 "레거시, 비활성화"로 갱신.
- `MANZO/05 - 트러블슈팅 로그.md`: 키움 8050 이슈의 "다음 조치"를 "보류 — 스케줄 끔, 필요시 고객센터 문의 후 재개"로 갱신.
- `.semiclass/brand-vibecoding-progress.md`: 해당되는 단계가 있으면 갱신 (내용 확인 후 반영).

## 롤백 방법

- Windows 작업: `Enable-ScheduledTask -TaskName "ManzoStockAnalysis"`
- Vercel Cron: `vercel.json`에 `crons` 항목을 다시 추가하고 push
- Cowork 작업: Cowork UI에서 재활성화 (사용자 몫)

## 이번 범위에서 제외

- 마켓 스코프 파이프라인(Windows `ManzoMarketScope` vs Cowork `market-scope-daily-update` 중복)은 별도 브레인스토밍 대상이며 이번 변경에 포함하지 않는다.
