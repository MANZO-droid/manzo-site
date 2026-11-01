# 상승률 파이프라인 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상승률 상위10 자동화를 네이버+Gemini(`collect_gainers.py`) 단일 경로로 정리한다 — 레거시로 대체된 Windows 작업(`ManzoStockAnalysis`)을 끄고, 13일째 실패 중인 Vercel Cron(키움+Supabase) 스케줄을 코드는 남긴 채 끄고, 관련 문서를 현재 상태로 갱신한다.

**Architecture:** 코드 변경 없음. (1) Windows 작업 스케줄러 상태 변경(Disable, 삭제 아님), (2) `vercel.json`에서 `crons` 배열만 제거(함수 코드는 그대로), (3) `MANZO/04`, `MANZO/05` 문서 갱신. 각 변경은 독립적으로 되돌릴 수 있어야 한다.

**Tech Stack:** PowerShell(작업 스케줄러), git, vercel.json(JSON), Markdown 문서.

## Global Constraints

- **git push는 사용자의 명시적 확인 없이 실행하지 않는다.** (이 저장소는 git push = Vercel 프로덕션 배포이며, `vercel.json` 변경은 실제 운영 중인 크론 스케줄을 끄는 행위이므로 [CLAUDE.md](../../../CLAUDE.md)의 "배포처럼 위험한 작업은 계획 먼저 제시 후 승인받고 진행" 원칙 적용)
- **Windows 작업 스케줄러는 `Disable-ScheduledTask`만 사용한다.** `Unregister-ScheduledTask`(완전 삭제) 금지 — 되돌릴 수 있어야 함
- `api/cron-update-gainers.js`, `api/_kiwoom.js` 등 키움 관련 코드는 이번 작업에서 **삭제하지 않는다** (스펙: "일단 보류")
- 이번 계획은 상승률 파이프라인에 한정한다. 마켓 스코프 파이프라인(`ManzoMarketScope` vs Cowork `market-scope-daily-update`)은 범위 밖

---

## Task 1: 레거시 Windows 작업(`ManzoStockAnalysis`) 비활성화

**Files:** 없음 (시스템 상태 변경, 저장소 파일 아님)

**Interfaces:**
- Consumes: 없음
- Produces: `ManzoStockAnalysis` 작업의 `State`가 `Disabled`로 바뀜 — Task 4에서 이 사실을 문서에 기록할 때 참조

- [ ] **Step 1: 변경 전 상태 확인**

Run:
```powershell
Get-ScheduledTask -TaskName "ManzoStockAnalysis" | Select-Object TaskName, State
```
Expected: `State`가 `Ready`

- [ ] **Step 2: 비활성화**

Run:
```powershell
Disable-ScheduledTask -TaskName "ManzoStockAnalysis"
```

- [ ] **Step 3: 비활성화 확인**

Run:
```powershell
Get-ScheduledTask -TaskName "ManzoStockAnalysis" | Select-Object TaskName, State
```
Expected: `State`가 `Disabled`

- [ ] **Step 4: 다른 작업들은 그대로인지 확인 (회귀 방지)**

Run:
```powershell
Get-ScheduledTask -TaskName "ManzoGainers_Daily","ManzoGainers_Weekly","ManzoMarketScope" | Select-Object TaskName, State
```
Expected: 셋 다 `Ready` (건드리지 않았어야 함)

(이 태스크는 저장소 파일을 바꾸지 않으므로 git 커밋 없음)

---

## Task 2: `vercel.json`에서 Cron 스케줄 제거 (로컬 커밋까지만, push는 Task 3)

**Files:**
- Modify: `vercel.json`

**Interfaces:**
- Consumes: 없음
- Produces: `vercel.json`에 `crons` 키가 없는 상태 — Task 3(push)이 이 커밋을 배포

- [ ] **Step 1: 현재 내용 확인**

`vercel.json` 현재 전체 내용:
```json
{
  "regions": ["icn1"],
  "crons": [
    {
      "path": "/api/cron-update-gainers",
      "schedule": "0 7 * * *"
    }
  ],
  "functions": {
    "api/cron-update-gainers.js": {
      "maxDuration": 60
    }
  }
}
```

- [ ] **Step 2: `crons` 배열 제거**

`vercel.json`을 아래 내용으로 교체 (`functions`, `regions`는 유지 — `api/cron-update-gainers.js` 엔드포인트 자체는 남겨두고 수동/향후 호출은 계속 가능해야 하므로):
```json
{
  "regions": ["icn1"],
  "functions": {
    "api/cron-update-gainers.js": {
      "maxDuration": 60
    }
  }
}
```

- [ ] **Step 3: JSON 유효성 확인**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('valid')"
```
Expected: `valid` 출력 (에러 없음)

- [ ] **Step 4: diff 확인**

Run:
```bash
git diff vercel.json
```
Expected: `crons` 블록만 제거된 diff, `functions`/`regions`는 그대로

- [ ] **Step 5: 커밋 (로컬만, push 아님)**

Run:
```bash
git add vercel.json
git commit -m "$(cat <<'EOF'
fix: 실패 중인 키움 Vercel Cron 스케줄 비활성화

daily_gainers 최신 데이터가 2026-07-12에서 멈춰있음 — 키움 지정단말기
인증(8050) 문제로 13일 연속 실패 중. 코드(api/cron-update-gainers.js,
api/_kiwoom.js)는 남겨두고 스케줄만 끈다. 나중에 키움 문제가 풀리면
vercel.json에 crons 항목을 다시 추가해 재개.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: 커밋 후 status로 다른 파일이 같이 끌려가지 않았는지 확인**

Run:
```bash
git show --stat HEAD
```
Expected: `vercel.json` 1개 파일만 나열됨. **다른 파일이 보이면 즉시 `git reset --soft HEAD~1`로 되돌리고 원인을 파악할 것** (이전에 이미 한 번 이 실수가 발생했음 — 커밋 전 스테이징된 무관한 파일이 섞여 들어감).

---

## Task 3: [확인 게이트] 사용자 승인 후 push (실제 배포)

**Files:** 없음 (원격 저장소/배포 상태 변경)

**Interfaces:**
- Consumes: Task 2에서 만든 로컬 커밋
- Produces: `main` 브랜치에 push되어 Vercel이 재배포 → 다음날부터 Vercel Cron이 더 이상 `/api/cron-update-gainers`를 호출하지 않음

- [ ] **Step 1: 반드시 STOP — push 전에 사용자에게 명시적으로 확인받는다**

이 저장소는 "git push = 프로덕션 배포"이고, 이 변경은 실제로 돌고 있는 (비록 실패하고는 있지만) 크론 스케줄을 끄는 행위다. **Task 2까지 끝난 상태에서 자동으로 진행하지 말고, 사용자에게 다음을 확인**:

> "vercel.json 변경사항을 push할까요? push하면 Vercel이 재배포되고, 그 시점부터 키움 Cron이 더 이상 자동 호출되지 않습니다(코드는 남아있어 나중에 되돌릴 수 있음)."

사용자가 "네/진행해줘" 등으로 명확히 승인한 뒤에만 Step 2를 실행한다.

- [ ] **Step 2: push**

Run:
```bash
git push
```

- [ ] **Step 3: 배포 확인**

Run:
```bash
vercel ls manzo-site --meta 2>&1 | head -5
```
또는 사용자에게 Vercel 대시보드(Deployments 탭)에서 새 배포가 시작됐는지 확인 요청.

---

## Task 4: 문서 갱신 (`MANZO/04`, `MANZO/05`)

**Files:**
- Modify: `MANZO/04 - 데이터 파이프라인.md`
- Modify: `MANZO/05 - 트러블슈팅 로그.md`

**Interfaces:**
- Consumes: Task 1(작업 비활성화 완료), Task 3(push 완료 여부 — push를 사용자가 아직 승인하지 않았다면 문서에 "커밋 완료, push 대기 중"으로 기록)
- Produces: 없음 (문서만)

- [ ] **Step 1: `MANZO/04 - 데이터 파이프라인.md`의 "키움 API 완전자동화" 절 갱신**

`## 키움 API 완전자동화 (진행 중)` 절의 "**현재 막힌 지점 (2026-07-12 기준)**" 문단 뒤에 아래 내용 추가:

```markdown
**2026-07-25 결정: 스케줄 비활성화 (코드는 보존)**

`daily_gainers` 최신 데이터가 2026-07-12에서 멈춘 채 13일간 갱신되지 않아,
`vercel.json`에서 `crons` 항목을 제거해 자동 호출을 껐다. `api/cron-update-gainers.js`,
`api/_kiwoom.js`는 그대로 남겨뒀으니, 지정단말기 문제가 풀리면 `vercel.json`에
crons 항목을 다시 추가해 재개하면 된다. 자세한 배경은
[[../docs/superpowers/specs/2026-07-25-gainers-automation-cleanup-design|2026-07-25 설계 문서]] 참고.
```

- [ ] **Step 2: 같은 파일의 "Cowork 자동화 추가" 절, `rise-reason-daily-analysis` 항목에 상태 추가**

`### 2) rise-reason-daily-analysis (매일 16:30경)` 절 끝에 아래 한 줄 추가:

```markdown

> **2026-07-25 기준**: 이 작업이 읽는 Vercel Cron(위 "키움 API 완전자동화" 참고)이 스케줄 비활성화됨. 이 작업도 Cowork 쪽에서 사용자가 직접 비활성화해야 함(같은 날짜 결정).
```

- [ ] **Step 3: 같은 파일에서, `ManzoStockAnalysis`/`daily_stock_analysis.py`가 언급된 부분이 있는지 확인**

Run:
```bash
grep -n "daily_stock_analysis\|ManzoStockAnalysis" "MANZO/04 - 데이터 파이프라인.md"
```
Expected: 매치 없음 (원래 이 파일에 대한 언급이 없었음 — 확인만 하고 없으면 다음 단계로)

- [ ] **Step 4: `MANZO/05 - 트러블슈팅 로그.md`의 "진행 중 (미해결)" 절 갱신**

`**키움증권 API "지정단말기" 인증 에러 (8050)**` 항목의 "다음 조치(계획): 키움 고객센터(1544-9000)에 지정단말기 서비스 해제 문의" 줄을 아래로 교체:

```markdown
- 다음 조치(계획): 키움 고객센터(1544-9000)에 지정단말기 서비스 해제 문의 — 아직 문의 전
- **2026-07-25**: 13일간 미해결로 확인돼 `vercel.json`의 크론 스케줄을 비활성화(코드는 보존). 문의 후 해결되면 재활성화 예정
```

- [ ] **Step 5: 같은 파일에 레거시 중복 작업(`ManzoStockAnalysis`) 트러블슈팅 항목 추가**

`## 진행 중 (미해결)` 절 앞에 새 절 추가:

```markdown
## 자동화 정리 (2026-07-25)

**같은 파일(`stock-analysis-data.json`)에 두 Windows 작업이 30분 간격으로 경쟁**
- 증상: `ManzoGainers_Daily`(16:00, `scripts/collect_gainers.py`)와 `ManzoStockAnalysis`(16:30, 외부 폴더의 `daily_stock_analysis.py`)가 같은 목적(상승률·거래대금 상위10 수집 → 같은 JSON 갱신 → git push)으로 중복 등록돼 있었음
- 원인: `daily_stock_analysis.py`(2026-07-07 마지막 수정)가 `collect_gainers.py`(2026-07-17 첫 커밋)로 대체됐는데, 예전 작업을 끄는 걸 잊음
- 해결: `ManzoStockAnalysis`를 `Disable-ScheduledTask`로 비활성화(삭제는 아님). `collect_gainers.py` 경로만 남김
```

- [ ] **Step 6: diff 검토**

Run:
```bash
git diff "MANZO/04 - 데이터 파이프라인.md" "MANZO/05 - 트러블슈팅 로그.md"
```
Expected: 위에서 계획한 추가 내용만 보임, 기존 텍스트 삭제 없음

- [ ] **Step 7: 커밋**

Run:
```bash
git add "MANZO/04 - 데이터 파이프라인.md" "MANZO/05 - 트러블슈팅 로그.md"
git commit -m "$(cat <<'EOF'
docs: 상승률 파이프라인 정리 결과를 지식백과에 반영

ManzoStockAnalysis(레거시 중복 작업) 비활성화, 키움 Vercel Cron 스케줄
비활성화(코드 보존) 결정을 04/05 문서에 기록.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: 커밋 후 다른 파일이 안 끌려왔는지 확인**

Run:
```bash
git show --stat HEAD
```
Expected: 위 두 문서 파일만 나열됨.

---

## 사용자가 직접 해야 하는 일 (이 세션에서 자동화 불가)

이 Claude Code 세션은 Cowork의 예약 작업 스케줄러에 접근 권한이 없다(`CronList`/`scheduled-tasks` 도구 모두 비어 있음 — 별도 제품/계정). 아래는 사용자가 Cowork 쪽 UI에서 직접 해야 한다:

- [ ] Cowork 예약 작업 `rise-reason-daily-analysis`(매일 16:30경) 비활성화 또는 일시정지
  - 이유: 이 작업이 읽는 Supabase `daily_gainers` 표가 Task 2/3에서 자동 갱신을 껐으므로, 계속 켜둬도 매일 "오늘 데이터 없음"만 반복함
  - 나중에 키움 경로를 재개하면 이 작업도 같이 재활성화하면 됨

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 4개 결정사항(A 유지/C 비활성화/B 스케줄만 끄기·코드 보존/D는 사용자 안내) 모두 Task 1~4 + 마지막 섹션에서 다뤄짐. 롤백 방법(스펙 문서에 기재)은 Task 1/2가 각각 `Enable-ScheduledTask`, `crons` 재추가로 되돌릴 수 있는 구조라 별도 태스크 불필요.
- **플레이스홀더 스캔**: 없음 — 모든 스텝에 실행 가능한 정확한 명령/텍스트 포함.
- **타입/이름 일관성**: 해당 없음(코드 변경 없음, 파일 경로·작업 이름은 전 태스크에서 동일하게 사용: `ManzoStockAnalysis`, `vercel.json`, `MANZO/04 - 데이터 파이프라인.md`, `MANZO/05 - 트러블슈팅 로그.md`).
