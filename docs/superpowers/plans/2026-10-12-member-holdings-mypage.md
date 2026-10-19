# 회원 My page 보유 종목 기록장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회장님이 허용한 회원만 My page에서 "본인 보유 종목 기록장"(등록·보유/관찰/청산·분할 매도·삭제·평가손익)을 쓸 수 있게 한다.

**Architecture:** 회원용 장부는 회장님 원장(PC `positions.csv`)과 완전히 분리해 Supabase `public.member_*` 표에 둔다. 브라우저가 anon key + 로그인 세션으로 직접 읽고 쓰며(RLS로 본인 행만, 허용 회원만), PC 폴링은 쓰지 않는다. 현재가와 차트 위치 지표는 PC가 매일 장 마감 후 전 종목 종가·이동평균·52주 고저를 `public.member_prices`에, 회원이 들고 있는 종목의 최근 60일 종가와 뉴스 헤드라인을 `public.member_stock_detail`에 올려서 공급한다. 회원이 청산하면 DB 트리거가 회원·보유 기록과 연결되지 않는 익명 매매 기록 1건을 `member_trade_stats`에 남기고, 회장님은 집계 결과만 본다.

**Tech Stack:** Supabase(Postgres + RLS + plpgsql RPC), 정적 HTML + 인라인 JS(supabase-js CDN, 기존 로그인 방식 그대로), Vercel 서버리스(`api/*.js`, 관리자 허용 토글 1개), PC 쪽 Python(`stock_screener`, 기존 `supabase_client._upsert` 재사용), 테스트는 `node --test`(의존성 없음)·`unittest`·SQL 어서션.

## Global Constraints

- **기록·사실 정보만 보여준다.** 허용하는 정보는 (a) 회원이 입력한 기록의 계산값, (b) 종목별 **차트 위치 사실 수치**(이동평균 대비 %, 52주 고저 대비 %, 정배열/역배열/혼조), (c) 종목 관련 **뉴스 헤드라인 목록**(제목·출처·날짜·링크, 모든 회원에게 동일)이다. 매도·매수 신호, "청산 필요" 알림, 종목 추천, 뉴스 호재/악재 판정, 과열·저평가 같은 평가어, 회원별 코멘트·메일·푸시는 **넣지 않는다**(투자자문업 "개별성" 경계, `publish_member_picks.py` 원칙 1~4와 동일). 회원이 직접 정한 본인 기준 알림도 범위 밖(변호사 검토 후 별도 계획).
- **회장님은 회원 개개인의 보유·매매를 보지 않는다.** 관리자 화면·API는 `member_holdings`·`member_holding_sales`를 읽지 않는다. 통계는 회원·보유 기록과 연결고리가 없는 별도 익명 표(`member_trade_stats`)와 집계 함수(Task 8)로만 제공한다. 종목별 집계는 표본 3건(보유 집계는 3명) 미만이면 숨긴다.
- **RLS가 꺼져 있는 `public.admin_issue_cache`·`public.repair_log`는 그대로 둔다**(회장님 결정 2026-10-19: 자동 수리 보호). 이 계획의 어떤 작업도 두 표를 변경하지 않는다.
- **회장님 원장·회장님 보유 종목은 회원 화면에 절대 노출하지 않는다.** 회원 표는 `stock_screener.trend_positions`·`position_requests`를 읽거나 쓰지 않는다.
- **service role key는 코드·채팅에 노출 금지.** 브라우저는 anon key만 쓴다(기존 `index.html`과 동일).
- **새 패키지 설치 금지**(공개 3일 미만 금지 규칙, 필요도 없음). `node:test`, `unittest`, 기존 supabase-js CDN만 쓴다.
- **회원 데이터는 회원 본인 + 회장님(관리자 API, service role)만 접근.** 회원 탈퇴(`auth.users` 삭제) 시 `on delete cascade`로 같이 지운다.
- **허용 회원이 아니면 표 접근 자체가 RLS에서 막힌다**(화면 숨김은 편의일 뿐, 보안 장치가 아니다).
- 한 회원당 보유 행 최대 **50개**, 한 번에 등록 최대 **10종목**(관리자 폼과 동일한 최대 행 수).
- 화면 문구에는 항상 면책 한 줄: "본 기록장은 회원님이 직접 입력한 내용을 계산해 보여줄 뿐이며, 투자 권유·자문이 아닙니다. 투자 판단과 책임은 본인에게 있습니다."
- 커밋 메시지는 `feat: ...` / `fix: ...` 한글 설명, 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- 배포 = `main` push(Vercel 자동). **DB 마이그레이션은 Supabase에 적용한 뒤 파일로도 `db/`에 남긴다.**

## File Structure

사이트 저장소 `E:\AI\프로젝트\만조인베스트 웹페이지 관리`:

| 파일 | 역할 |
|---|---|
| `db/002_member_holdings.sql` (신규) | 표 4개(`member_feature_access`, `member_holdings`, `member_holding_sales`, `member_prices`), 접근 함수, RLS, 행 수 제한 트리거, `member_sell` RPC |
| `db/002_member_holdings_rls_test.sql` (신규) | 두 가짜 회원으로 RLS를 검증하는 어서션 (트랜잭션 후 롤백) |
| `lib/holdings-calc.js` (신규) | 평균단가·평가손익·실현손익 순수 계산 함수 (브라우저/Node 공용) |
| `test/holdings-calc.test.js` (신규) | 위 계산의 `node --test` 테스트 |
| `api/admin-member-access.js` (신규) | 관리자만: 회원별 기록장 허용 목록 조회·허용·해제 (service role) |
| `admin.html` (수정) | 회원 관리 표에 "기록장 허용" 토글 열 추가 |
| `mypage.html` (신규) | 회원 My page: 로그인 확인 → 허용 확인 → 기록장 표·입력폼 |
| `index.html` (수정) | 허용 회원에게만 상단 메뉴에 "My page" 링크 노출 |
| `db/003_member_anon_stats.sql` (신규) | 익명 매매 기록 표·트리거, 관리자 전용 집계 함수, 보유 종목 코드 목록 함수 |
| `db/003_member_anon_stats_test.sql` (신규) | 익명성·집계 최소 표본·권한 어서션 |
| `api/admin-member-stats.js` (신규) | 관리자만: 익명 집계 결과 조회(원본 표는 읽지 않음) |
| `db/004_member_chart_news.sql` (신규) | `member_prices` 지표 열 추가, `member_stock_detail` 표 |

PC 저장소 `E:\AI\프로젝트\만조 로드맵\stock_screener`:

| 파일 | 역할 |
|---|---|
| `publish_member_prices.py` (신규) | `market_cache` 최신 거래일의 전 종목 종가·20일선을 `public.member_prices`에 upsert |
| `test_publish_member_prices.py` (신규) | 위 변환 로직 `unittest` |
| `daily_check.py` 호출 체인 또는 예약 작업 (수정) | 20:10 점검이 끝난 뒤 위 스크립트 실행 |
| `publish_member_stock_detail.py` (신규) | 회원 보유 종목 코드(코드만)에 대해 최근 60일 종가·뉴스 헤드라인을 `member_stock_detail`에 upsert |
| `test_publish_member_stock_detail.py` (신규) | 위 변환 로직 `unittest` |
| `supabase_client.py` (수정) | `rpc(name, params)` 함수 한 개 추가 |

---

### Task 1: DB 표·RLS·RPC

**Files:**
- Create: `db/002_member_holdings.sql`
- Create: `db/002_member_holdings_rls_test.sql`

**Interfaces:**
- Produces: 표 `public.member_feature_access(user_id uuid pk, holdings_enabled bool, granted_at timestamptz)`, `public.member_holdings`, `public.member_holding_sales`, `public.member_prices`; 함수 `public.member_has_holdings_access() returns boolean`; RPC `public.member_sell(p_holding uuid, p_qty numeric, p_price numeric, p_date date) returns public.member_holdings`.
- `member_holdings` 컬럼: `id uuid pk default gen_random_uuid()`, `user_id uuid`, `stock_code text`, `stock_name text`, `status text ('open'|'watch'|'closed')`, `avg_price numeric`, `initial_qty numeric`, `remaining_qty numeric`, `entry_date date`, `closed_on date`, `memo text`, `created_at timestamptz`.
- `member_holding_sales` 컬럼: `id bigint identity pk`, `holding_id uuid`, `user_id uuid`, `qty numeric`, `price numeric`, `sold_on date`, `created_at`.
- `member_prices` 컬럼: `stock_code text pk`, `stock_name text`, `market text`, `close numeric`, `ma20 numeric`, `trade_date date`, `updated_at timestamptz`.

- [ ] **Step 1: RLS 테스트 SQL 먼저 작성** — `db/002_member_holdings_rls_test.sql`

```sql
-- 실행: Supabase SQL Editor 또는 MCP execute_sql로 통째로 한 번에. 마지막에 롤백하므로 데이터가 남지 않는다.
begin;
  -- 가짜 회원 2명 (A: 허용, B: 미허용)
  insert into auth.users (id, instance_id, aud, role, email)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid'),
         ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid');
  insert into public.member_feature_access (user_id, holdings_enabled)
  values ('aaaaaaaa-0000-0000-0000-000000000001', true);

  -- A로 로그인한 상태 흉내
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

  do $$
  declare h public.member_holdings; n int;
  begin
    -- 1) 허용 회원은 본인 이름으로 등록할 수 있다
    insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '005930', '삼성전자', 'open', 70000, 10, 10, '2026-10-01')
    returning * into h;
    -- 2) 남의 user_id로는 등록할 수 없다
    begin
      insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
      values ('bbbbbbbb-0000-0000-0000-000000000002', '005930', 'x', 'open', 1, 1, 1, '2026-10-01');
      raise exception 'FAIL: 남의 user_id 등록이 통과됨';
    exception when insufficient_privilege or check_violation then null;
    end;
    -- 3) 분할 매도: 4주 매도 → 6주 남고 open 유지
    perform public.member_sell(h.id, 4, 75000, '2026-10-05');
    select remaining_qty into n from public.member_holdings where id = h.id;
    if n <> 6 then raise exception 'FAIL: 분할 매도 후 잔여 %', n; end if;
    -- 4) 남은 전량 매도 → closed
    perform public.member_sell(h.id, null, 80000, '2026-10-06');
    if (select status from public.member_holdings where id = h.id) <> 'closed' then
      raise exception 'FAIL: 전량 매도 후 closed 아님'; end if;
    -- 5) 잔여 수량보다 많이 팔 수 없다
    begin
      perform public.member_sell(h.id, 1, 1, '2026-10-07');
      raise exception 'FAIL: closed 종목 추가 매도가 통과됨';
    exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
    end;
  end $$;

  -- B(미허용)로 전환: A의 행이 안 보이고, 쓰기도 막혀야 한다
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  do $$
  declare n int;
  begin
    select count(*) into n from public.member_holdings;
    if n <> 0 then raise exception 'FAIL: B가 A의 행 % 개를 봄', n; end if;
    begin
      insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
      values ('bbbbbbbb-0000-0000-0000-000000000002', '005930', 'x', 'open', 1, 1, 1, '2026-10-01');
      raise exception 'FAIL: 미허용 회원 등록이 통과됨';
    exception when insufficient_privilege or check_violation then null;
    end;
    -- 허용 표를 스스로 바꿀 수 없다
    begin
      update public.member_feature_access set holdings_enabled = true
       where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'FAIL: 미허용 회원이 허용 표를 수정함'; end if;
    exception when insufficient_privilege then null;
    end;
  end $$;
rollback;
-- 어서션이 하나라도 실패하면 위에서 예외로 멈춘다. 끝까지 오면 통과.
```

- [ ] **Step 2: 마이그레이션 작성** — `db/002_member_holdings.sql`

```sql
-- 회원 My page 보유 종목 기록장 (2026-10-12 설계). 회장님 원장(stock_screener.*)과 완전히 별개다.
create table if not exists public.member_feature_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  holdings_enabled boolean not null default false,
  granted_at timestamptz not null default now()
);
alter table public.member_feature_access enable row level security;
-- 회원은 자기 행만 읽을 수 있다(화면에서 메뉴 노출 판단용). 쓰기 정책은 두지 않는다 → 관리자 API(service role)만 쓴다.
drop policy if exists "read own access" on public.member_feature_access;
create policy "read own access" on public.member_feature_access
  for select to authenticated using (user_id = auth.uid());

create or replace function public.member_has_holdings_access() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member_feature_access
                  where user_id = auth.uid() and holdings_enabled);
$$;
revoke all on function public.member_has_holdings_access() from public;
grant execute on function public.member_has_holdings_access() to authenticated;

create table if not exists public.member_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stock_code text not null check (stock_code ~ '^[0-9]{6}$'),
  stock_name text not null check (char_length(stock_name) between 1 and 40),
  status text not null default 'open' check (status in ('open','watch','closed')),
  avg_price numeric not null check (avg_price > 0),
  initial_qty numeric not null check (initial_qty > 0),
  remaining_qty numeric not null check (remaining_qty >= 0),
  entry_date date not null,
  closed_on date,
  memo text check (char_length(memo) <= 200),
  created_at timestamptz not null default now(),
  check (remaining_qty <= initial_qty),
  check ((status = 'closed') = (remaining_qty = 0))
);
create index if not exists member_holdings_user_idx on public.member_holdings (user_id, status);
alter table public.member_holdings enable row level security;

drop policy if exists "own select" on public.member_holdings;
create policy "own select" on public.member_holdings for select to authenticated
  using (user_id = auth.uid() and public.member_has_holdings_access());
drop policy if exists "own insert" on public.member_holdings;
create policy "own insert" on public.member_holdings for insert to authenticated
  with check (user_id = auth.uid() and public.member_has_holdings_access());
drop policy if exists "own update" on public.member_holdings;
create policy "own update" on public.member_holdings for update to authenticated
  using (user_id = auth.uid() and public.member_has_holdings_access())
  with check (user_id = auth.uid() and public.member_has_holdings_access());
drop policy if exists "own delete" on public.member_holdings;
create policy "own delete" on public.member_holdings for delete to authenticated
  using (user_id = auth.uid() and public.member_has_holdings_access());

-- 한 회원당 최대 50행
create or replace function public.member_holdings_cap() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.member_holdings where user_id = new.user_id) >= 50 then
    raise exception '보유 기록은 최대 50개까지 등록할 수 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists member_holdings_cap_trg on public.member_holdings;
create trigger member_holdings_cap_trg before insert on public.member_holdings
  for each row execute function public.member_holdings_cap();

create table if not exists public.member_holding_sales (
  id bigint generated always as identity primary key,
  holding_id uuid not null references public.member_holdings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  qty numeric not null check (qty > 0),
  price numeric not null check (price > 0),
  sold_on date not null,
  created_at timestamptz not null default now()
);
create index if not exists member_holding_sales_holding_idx on public.member_holding_sales (holding_id);
alter table public.member_holding_sales enable row level security;
drop policy if exists "own sales select" on public.member_holding_sales;
create policy "own sales select" on public.member_holding_sales for select to authenticated
  using (user_id = auth.uid() and public.member_has_holdings_access());
-- insert/update/delete 정책 없음: 매도 기록은 member_sell RPC로만 만든다.

-- 분할/전량 매도를 원자적으로 처리. p_qty가 null이면 남은 수량 전부.
create or replace function public.member_sell(p_holding uuid, p_qty numeric, p_price numeric, p_date date)
returns public.member_holdings
language plpgsql security definer set search_path = public as $$
declare h public.member_holdings; q numeric;
begin
  if auth.uid() is null or not public.member_has_holdings_access() then
    raise exception '권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;
  select * into h from public.member_holdings
   where id = p_holding and user_id = auth.uid() and status in ('open','watch') for update;
  if not found then raise exception '보유 또는 관찰 중인 종목이 아닙니다'; end if;
  q := coalesce(p_qty, h.remaining_qty);
  if q <= 0 or q > h.remaining_qty then
    raise exception '매도 수량은 1 이상 남은 수량(%) 이하여야 합니다', h.remaining_qty;
  end if;
  if p_price is null or p_price <= 0 then raise exception '매도가를 입력하세요'; end if;
  insert into public.member_holding_sales (holding_id, user_id, qty, price, sold_on)
  values (h.id, h.user_id, q, p_price, coalesce(p_date, current_date));
  update public.member_holdings
     set remaining_qty = h.remaining_qty - q,
         status = case when h.remaining_qty - q = 0 then 'closed' else h.status end,
         closed_on = case when h.remaining_qty - q = 0 then coalesce(p_date, current_date) else null end
   where id = h.id
  returning * into h;
  return h;
end $$;
revoke all on function public.member_sell(uuid, numeric, numeric, date) from public;
grant execute on function public.member_sell(uuid, numeric, numeric, date) to authenticated;

-- 전 종목 종가·20일선 (PC가 매일 service role로 upsert). 공개 시세라 허용 회원 누구나 읽는다.
create table if not exists public.member_prices (
  stock_code text primary key check (stock_code ~ '^[0-9]{6}$'),
  stock_name text,
  market text,
  close numeric,
  ma20 numeric,
  trade_date date not null,
  updated_at timestamptz not null default now()
);
alter table public.member_prices enable row level security;
drop policy if exists "prices read" on public.member_prices;
create policy "prices read" on public.member_prices for select to authenticated
  using (public.member_has_holdings_access());
```

- [ ] **Step 3: 테스트가 "표 없음"으로 실패하는지 확인** (적용 전)

Run: MCP `execute_sql`(project `nxvpipgvcrfkujbvjjak`)로 `002_member_holdings_rls_test.sql` 실행
Expected: `relation "public.member_feature_access" does not exist` 오류

- [ ] **Step 4: 마이그레이션 적용** — MCP `apply_migration`(name: `member_holdings`, query: 2번 파일 전체)

Expected: 성공(오류 없음)

- [ ] **Step 5: RLS 테스트 재실행**

Run: 같은 `execute_sql`로 `002_member_holdings_rls_test.sql`
Expected: 오류 없이 끝남(`FAIL:` 예외 없음). 실패하면 정책을 고치고 이 단계 반복.

- [ ] **Step 6: 보안 점검 + 정리 확인**

Run: MCP `get_advisors`(type: security)
Expected: `member_*` 표에 대한 RLS 경고 없음. 기존 `public.admin_issue_cache`·`public.repair_log`의 RLS 경고는 **회장님 결정에 따라 그대로 둔다**(건드리지 않는다, 경고가 남아 있어도 정상).
Run: `execute_sql`: `select count(*) from auth.users where email like '%@test.invalid';`
Expected: `0` (테스트가 롤백됨)

- [ ] **Step 7: Commit**

```bash
git add db/002_member_holdings.sql db/002_member_holdings_rls_test.sql
git commit -m "feat: 회원 보유 기록장 표·RLS·분할 매도 RPC 추가"
```

---

### Task 2: 계산 라이브러리 (평가손익·실현손익)

**Files:**
- Create: `lib/holdings-calc.js`
- Create: `test/holdings-calc.test.js`

**Interfaces:**
- Produces: `HoldingsCalc.summarize(holding, sales, price)` → `{ remaining, invested, marketValue, unrealized, unrealizedPct, realized, realizedPct, maGapPct, priceStale }`.
  - `holding`: `{avg_price, initial_qty, remaining_qty, status}` (숫자 또는 숫자 문자열)
  - `sales`: `[{qty, price}]` 이 종목의 매도 기록
  - `price`: `{close, ma20, trade_date}` 또는 `null`
  - 값이 없으면 `null`(0으로 위장하지 않는다). `priceStale`은 `trade_date`가 오늘(KST)보다 5일 넘게 오래됐을 때 `true`.
- Produces: `HoldingsCalc.totals(rows)` → `{ invested, marketValue, unrealized, realized }` (`rows`는 `summarize` 결과 배열, `null`은 합산에서 제외).

- [ ] **Step 1: 실패하는 테스트 작성** — `test/holdings-calc.test.js`

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, totals } = require('../lib/holdings-calc.js');

test('보유 중: 평가손익은 (현재가-평단)*잔여수량', () => {
  const s = summarize({ avg_price: 10000, initial_qty: 10, remaining_qty: 10, status: 'open' },
    [], { close: 11000, ma20: 10000, trade_date: '2026-10-12' }, '2026-10-12');
  assert.equal(s.unrealized, 10000);
  assert.equal(s.unrealizedPct, 10);
  assert.equal(s.maGapPct, 10);
  assert.equal(s.priceStale, false);
});

test('분할 매도: 실현손익은 매도 건별 (매도가-평단)*수량 합', () => {
  const s = summarize({ avg_price: 10000, initial_qty: 10, remaining_qty: 6, status: 'open' },
    [{ qty: 4, price: 12000 }], { close: 11000, ma20: null, trade_date: '2026-10-12' }, '2026-10-12');
  assert.equal(s.realized, 8000);
  assert.equal(s.unrealized, 6000);
  assert.equal(s.maGapPct, null);
});

test('청산: 평가손익 없음, 실현손익만', () => {
  const s = summarize({ avg_price: 10000, initial_qty: 5, remaining_qty: 0, status: 'closed' },
    [{ qty: 5, price: 9000 }], null, '2026-10-12');
  assert.equal(s.unrealized, null);
  assert.equal(s.realized, -5000);
  assert.equal(s.realizedPct, -10);
});

test('시세 없음: 평가 값은 null (0으로 표시하지 않는다)', () => {
  const s = summarize({ avg_price: 10000, initial_qty: 5, remaining_qty: 5, status: 'open' }, [], null, '2026-10-12');
  assert.equal(s.marketValue, null);
  assert.equal(s.unrealized, null);
});

test('시세가 6일 이상 오래되면 stale', () => {
  const s = summarize({ avg_price: 1, initial_qty: 1, remaining_qty: 1, status: 'open' }, [],
    { close: 1, ma20: 1, trade_date: '2026-10-01' }, '2026-10-12');
  assert.equal(s.priceStale, true);
});

test('숫자 문자열도 처리 (Supabase numeric은 문자열로 온다)', () => {
  const s = summarize({ avg_price: '10000', initial_qty: '10', remaining_qty: '10', status: 'open' },
    [], { close: '10500', ma20: '10000', trade_date: '2026-10-12' }, '2026-10-12');
  assert.equal(s.unrealized, 5000);
});

test('totals: null은 제외하고 합산', () => {
  const t = totals([
    { invested: 100, marketValue: 120, unrealized: 20, realized: 5 },
    { invested: 50, marketValue: null, unrealized: null, realized: -3 },
  ]);
  assert.deepEqual(t, { invested: 150, marketValue: 120, unrealized: 20, realized: 2 });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/holdings-calc.test.js`
Expected: FAIL — `Cannot find module '../lib/holdings-calc.js'`

- [ ] **Step 3: 구현** — `lib/holdings-calc.js`

```javascript
(function (root) {
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  }
  // today: 'YYYY-MM-DD' (KST 기준 오늘). 테스트에서 주입한다.
  function summarize(holding, sales, price, today) {
    const avg = num(holding.avg_price);
    const remaining = num(holding.remaining_qty);
    const close = price ? num(price.close) : null;
    const ma20 = price ? num(price.ma20) : null;
    let realized = 0, soldCost = 0;
    (sales || []).forEach(function (s) {
      const q = num(s.qty), p = num(s.price);
      if (q === null || p === null || avg === null) return;
      realized += (p - avg) * q;
      soldCost += avg * q;
    });
    const hasSales = (sales || []).length > 0;
    const open = holding.status !== 'closed' && remaining > 0;
    const invested = avg !== null && remaining !== null ? avg * remaining : null;
    const marketValue = open && close !== null ? close * remaining : null;
    const unrealized = marketValue !== null && invested !== null ? marketValue - invested : null;
    return {
      remaining: remaining,
      invested: open ? invested : 0,
      marketValue: marketValue,
      unrealized: unrealized,
      unrealizedPct: unrealized !== null && invested ? (unrealized / invested) * 100 : null,
      realized: hasSales ? realized : null,
      realizedPct: hasSales && soldCost ? (realized / soldCost) * 100 : null,
      maGapPct: open && close !== null && ma20 ? (close / ma20 - 1) * 100 : null,
      priceStale: price && price.trade_date && today ? daysBetween(price.trade_date, today) > 5 : false,
    };
  }
  function totals(rows) {
    const t = { invested: 0, marketValue: 0, unrealized: 0, realized: 0 };
    rows.forEach(function (r) {
      if (!r) return;
      ['invested', 'marketValue', 'unrealized', 'realized'].forEach(function (k) {
        if (r[k] !== null && r[k] !== undefined) t[k] += r[k];
      });
    });
    return t;
  }
  const api = { summarize: summarize, totals: totals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HoldingsCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/holdings-calc.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/holdings-calc.js test/holdings-calc.test.js
git commit -m "feat: 회원 기록장 평가손익·실현손익 계산 라이브러리"
```

---

### Task 3: 관리자 허용 토글 API + 회원 관리 화면

**Files:**
- Create: `api/admin-member-access.js`
- Modify: `admin.html` (회원 관리 표 — `api/admin-users` 결과를 그리는 부분. 구현 시 `/api/admin-users` 호출 코드를 먼저 찾아 같은 렌더 함수에 열을 추가)

**Interfaces:**
- Produces: `GET /api/admin-member-access` → `{ enabled: ["<user_id>", ...] }`; `POST /api/admin-member-access` body `{ userId: string, enabled: boolean }` → `{ ok: true }`. 둘 다 관리자(`ADMIN_EMAIL`) 로그인 토큰 필요.
- Consumes: Task 1의 `public.member_feature_access`.

- [ ] **Step 1: API 작성** — `api/admin-member-access.js` (`api/holdings.js`의 `verifyAdmin` 패턴 그대로)

```javascript
// [관리자 전용] 회원별 "보유 기록장" 사용 허용 목록 조회·변경.
// GET  /api/admin-member-access            → { enabled: [user_id, ...] }
// POST /api/admin-member-access            → { userId, enabled } 로 허용/해제
const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function verifyAdmin(req) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const user = await r.json();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !user || !user.email) return null;
  return user.email.toLowerCase() === adminEmail.toLowerCase() ? user : null;
}

module.exports = async function handler(req, res) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: '서버 설정이 없습니다' });
  if (!(await verifyAdmin(req))) return res.status(403).json({ error: '관리자만 사용할 수 있습니다' });
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/member_feature_access?select=user_id&holdings_enabled=eq.true`, { headers: H });
    if (!r.ok) return res.status(502).json({ error: '허용 목록을 불러오지 못했습니다' });
    const rows = await r.json();
    return res.status(200).json({ enabled: rows.map((x) => x.user_id) });
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    if (typeof b.userId !== 'string' || !UUID_RE.test(b.userId) || typeof b.enabled !== 'boolean') {
      return res.status(400).json({ error: 'userId(UUID)와 enabled(true/false)가 필요합니다' });
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/member_feature_access?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_id: b.userId, holdings_enabled: b.enabled, granted_at: new Date().toISOString() }]),
    });
    if (!r.ok) return res.status(502).json({ error: '저장하지 못했습니다' });
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'GET/POST만 지원합니다' });
};
```

- [ ] **Step 2: 로컬 스모크 확인(토큰 없이 403)**

Run: `vercel dev`가 없으면 `node -e "require('./api/admin-member-access.js')({method:'GET',headers:{}}, {status:c=>({json:o=>console.log(c,o)})})"`
Expected: `403 { error: '관리자만 사용할 수 있습니다' }` (service key 환경변수 없으면 먼저 500이 나오므로 `SUPABASE_SERVICE_ROLE_KEY=x`를 붙여 실행)

- [ ] **Step 3: admin.html 회원 표에 토글 열 추가**

회원 목록을 그리는 함수를 찾아(`grep -n "admin-users" admin.html`) 각 행 끝에 아래 셀을 추가하고, 목록 로드 시 `GET /api/admin-member-access`로 `enabled` 집합을 함께 읽는다.

```javascript
// 회원 목록 로드 직후
const accessRes = await fetch('/api/admin-member-access', { headers: { Authorization: 'Bearer ' + token } });
const accessSet = new Set(accessRes.ok ? (await accessRes.json()).enabled : []);
// 행 렌더 시
`<td><label class="switch-label"><input type="checkbox" class="member-access" data-uid="${u.id}" ${accessSet.has(u.id) ? 'checked' : ''}> 기록장</label></td>`
// 이벤트
document.addEventListener('change', async (e) => {
  const el = e.target.closest('.member-access');
  if (!el) return;
  el.disabled = true;
  const r = await fetch('/api/admin-member-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ userId: el.dataset.uid, enabled: el.checked }),
  });
  if (!r.ok) { el.checked = !el.checked; alert('저장하지 못했습니다. 다시 시도해 주세요.'); }
  el.disabled = false;
});
```

(`token`, `u.id`는 admin.html의 기존 변수명에 맞춘다 — 구현 시 기존 `admin-users` 호출부의 이름을 확인해서 쓴다. 회원 행에 `id`(user_id)가 없으면 `api/admin-users.js` 응답에 `id`를 추가한다.)

- [ ] **Step 4: 화면 확인** — `python -m http.server 3000`로 admin.html을 열어 체크박스가 보이고, 토글 시 `member_feature_access`에 행이 생기는지 MCP `execute_sql: select * from public.member_feature_access;`로 확인

Expected: 토글 ON → 행 1개 `holdings_enabled=true`, OFF → `false`

- [ ] **Step 5: Commit**

```bash
git add api/admin-member-access.js admin.html
git commit -m "feat: 관리자 회원 표에 보유 기록장 허용 토글 추가"
```

---

### Task 4: My page (mypage.html)

**Files:**
- Create: `mypage.html`

**Interfaces:**
- Consumes: Task 1 표·RPC, Task 2 `HoldingsCalc.summarize/totals`(`<script src="/lib/holdings-calc.js">`), 기존 로그인 세션(`supabase.createClient(SUPABASE_URL, SUPABASE_KEY)`, `index.html`과 같은 키·같은 localStorage 세션).
- Produces: 화면 상태 4가지 — 비로그인(로그인 안내), 로그인했으나 미허용(안내문), 허용(기록장), 오류.

화면 구성(위에서 아래): 면책 한 줄 → 요약 카드(투자금·평가금액·평가손익·실현손익, 시세 기준일) → **보유 표** → **관찰 표**(비어 있으면 숨김) → **청산 표**(접힘) → 등록 폼(3행 보이고 "+행 추가" 10행까지) → 로그아웃/메인 링크. 표 열: 종목(코드), 평균단가, 잔여수량, 현재가, 평가손익, 20일선 대비, 상태 드롭다운, 선택 체크박스. 디자인 변수(`--bg`, `--accent` 등)와 `.tbl-scroll`, 입력폼 CSS는 `admin.html`의 보유 포지션 섹션을 그대로 복사해 쓴다(공유 스타일시트가 없는 이 사이트의 방식).

- [ ] **Step 1: 골격 + 접근 판정** — 아래 스크립트가 `<body>` 끝에 들어간다

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/lib/holdings-calc.js"></script>
<script>
(function () {
  const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (n) => (n === null || n === undefined ? '-' : Math.round(n).toLocaleString('ko-KR') + '원');
  const pct = (n) => (n === null || n === undefined ? '-' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%');
  const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  let state = { holdings: [], sales: [], prices: {}, selected: new Set(), busy: false };

  function show(which) {   // 'login' | 'denied' | 'app' | 'error'
    ['login', 'denied', 'app', 'error'].forEach((k) => { $('view-' + k).hidden = k !== which; });
  }

  async function init() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return show('login');
    const { data: acc, error } = await sb.from('member_feature_access')
      .select('holdings_enabled').eq('user_id', data.session.user.id).maybeSingle();
    if (error) return show('error');
    if (!acc || !acc.holdings_enabled) return show('denied');
    show('app');
    await loadAll();
  }

  async function loadAll() {
    const [h, s] = await Promise.all([
      sb.from('member_holdings').select('*').order('entry_date', { ascending: false }),
      sb.from('member_holding_sales').select('holding_id, qty, price, sold_on'),
    ]);
    if (h.error || s.error) return show('error');
    state.holdings = h.data; state.sales = s.data;
    const codes = [...new Set(h.data.map((x) => x.stock_code))];
    state.prices = {};
    if (codes.length) {
      const p = await sb.from('member_prices').select('stock_code, close, ma20, trade_date').in('stock_code', codes);
      if (!p.error) p.data.forEach((r) => { state.prices[r.stock_code] = r; });
    }
    render();
  }
  window.__mypage = { init: init, loadAll: loadAll, sb: sb, state: state, esc: esc, won: won, pct: pct, kstToday: kstToday, $: $ };
  init();
})();
</script>
```

- [ ] **Step 2: 표 렌더 + 요약** — `render()` 구현: 상태별로 나눠 `HoldingsCalc.summarize(h, salesOf(h.id), prices[h.stock_code], kstToday())`를 계산해 행을 만든다. 시세가 없거나 `priceStale`이면 해당 셀에 "시세 대기"/"시세 지연" 배지를 붙이고, 요약 카드 아래에 "시세 기준일: YYYY-MM-DD (종가)"를 표시한다. 모든 사용자 입력 문자열은 `esc()`를 거친다(`innerHTML` 주입 방지).

- [ ] **Step 3: 등록 폼** — 종목코드(6자리)·평균 매수가·수량·매수일(선택, 기본 오늘)·메모. 종목명은 입력하지 않고 `member_prices`에서 코드로 조회해 채운다(없으면 "종목코드를 확인할 수 없습니다. 시세 수집 후 다시 시도하세요" 안내하고 저장하지 않는다 — 이름 없는 행이 생기지 않게).

```javascript
async function addHoldings(rows) {            // rows: [{code, avg, qty, date, memo}] 최대 10
  const codes = rows.map((r) => r.code);
  const p = await sb.from('member_prices').select('stock_code, stock_name').in('stock_code', codes);
  if (p.error) throw new Error('종목 정보를 불러오지 못했습니다');
  const names = Object.fromEntries(p.data.map((r) => [r.stock_code, r.stock_name]));
  const missing = codes.filter((c) => !names[c]);
  if (missing.length) throw new Error('확인할 수 없는 종목코드: ' + missing.join(', '));
  const { data: s } = await sb.auth.getSession();
  const payload = rows.map((r) => ({
    user_id: s.session.user.id, stock_code: r.code, stock_name: names[r.code], status: 'open',
    avg_price: r.avg, initial_qty: r.qty, remaining_qty: r.qty,
    entry_date: r.date || kstToday(), memo: r.memo || null,
  }));
  const ins = await sb.from('member_holdings').insert(payload);
  if (ins.error) throw new Error(ins.error.message);
}
```

입력 검증(클라이언트): 코드 `/^\d{6}$/`, 매수가·수량 `> 0`, 행 1~10개. 전부 통과해야 저장(관리자 폼과 같은 all-or-nothing). 서버 제약(CHECK·RLS)이 최종 방어선이다.

- [ ] **Step 4: 상태 변경·분할 매도·삭제**

```javascript
async function setStatus(id, status) {           // 'open' <-> 'watch'
  const r = await sb.from('member_holdings').update({ status }).eq('id', id).in('status', ['open', 'watch']);
  if (r.error) throw new Error(r.error.message);
}
async function sell(id, qty, price, date) {      // qty 비우면 전량
  const r = await sb.rpc('member_sell', { p_holding: id, p_qty: qty === '' ? null : Number(qty), p_price: Number(price), p_date: date || kstToday() });
  if (r.error) throw new Error(r.error.message);
}
async function deleteMany(ids) {                 // 기록에서 지움(매도 기록이 아님) — confirm 후 호출
  const r = await sb.from('member_holdings').delete().in('id', ids);
  if (r.error) throw new Error(r.error.message);
}
```

드롭다운에서 "청산"을 고르면 매도가·수량(비우면 전량)·매도일 입력 패널을 열고 `sell()`을 호출한다(관리자 페이지와 같은 흐름). 삭제는 `confirm("선택한 N개 기록을 지웁니다. 되돌릴 수 없습니다.")` 후 실행. 모든 쓰기 후 `loadAll()`로 다시 읽어 화면을 갱신하고, 실패는 `posSay` 같은 인라인 메시지로 원인을 보여준다(조용히 무시 금지).

- [ ] **Step 5: 브라우저 검증(허용·미허용 두 계정)**

Run: `python -m http.server 3000` → `http://localhost:3000/mypage.html`
Expected, 계정별:
- 비로그인: 로그인 안내만 보이고 표 요청이 나가지 않음(네트워크 탭에 `member_holdings` 없음)
- 로그인했으나 미허용: "아직 이용 대상이 아닙니다" 안내만, `member_holdings` 조회는 0건
- 허용: 등록 → 표에 즉시 반영, 상태 전환·부분 매도(남은 수량 감소, 실현손익 표시)·전량 매도(청산 표로 이동)·삭제 모두 동작
- 모바일 375px: 페이지 가로 스크롤 없음, 표만 자체 스크롤(관리자 페이지와 같은 `.tbl-scroll`)
- 콘솔 오류 0건

- [ ] **Step 6: Commit**

```bash
git add mypage.html
git commit -m "feat: 회원 My page 보유 종목 기록장 화면 추가"
```

---

### Task 5: 시세 공급 (PC → member_prices)

**Files:**
- Create: `E:\AI\프로젝트\만조 로드맵\stock_screener\publish_member_prices.py`
- Create: `E:\AI\프로젝트\만조 로드맵\stock_screener\test_publish_member_prices.py`
- Modify: 20:10 점검 직후 실행되도록 예약 작업(`TrendDailyCheck`)의 실행 체인 — 구현 시 `schtasks /query /tn TrendDailyCheck /xml`로 현재 명령을 확인한 뒤, 같은 `.bat`/`.ps1` 체인 끝에 한 줄 추가

**Interfaces:**
- Consumes: `market_cache/YYYYMMDD.csv`(열: `종목코드`, `종목명`, `시장구분`, `현재가`, `일자`), `supabase_client._upsert(table, rows, on_conflict, schema=None) -> bool`
- Produces: `build_rows(frames: list[pd.DataFrame]) -> list[dict]` — 인자는 최근 거래일 순 CSV 프레임(최소 20개), 각 dict는 `{stock_code, stock_name, market, close, ma20, trade_date}`.

- [ ] **Step 1: 실패하는 테스트** — `test_publish_member_prices.py`

```python
import unittest
import pandas as pd
import publish_member_prices as p


def frame(day, price, code="005930", name="삼성전자", market="KOSPI"):
    return pd.DataFrame([{"종목코드": code, "종목명": name, "시장구분": market,
                          "현재가": price, "일자": day}])


class BuildRowsTest(unittest.TestCase):
    def test_close_and_ma20(self):
        frames = [frame(f"202610{d:02d}", 100 + d) for d in range(1, 21)]   # 20일치, 마지막 120
        rows = p.build_rows(frames)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["stock_code"], "005930")
        self.assertEqual(r["close"], 120)
        self.assertEqual(r["trade_date"], "2026-10-20")
        self.assertAlmostEqual(r["ma20"], sum(100 + d for d in range(1, 21)) / 20)

    def test_less_than_20_days_has_no_ma20(self):
        rows = p.build_rows([frame("20261001", 100), frame("20261002", 110)])
        self.assertIsNone(rows[0]["ma20"])
        self.assertEqual(rows[0]["close"], 110)

    def test_skips_non_numeric_code_and_zero_price(self):
        f = pd.concat([frame("20261002", 100, code="00593A"), frame("20261002", 0, code="000660")])
        self.assertEqual(p.build_rows([f]), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest test_publish_member_prices -v` (stock_screener 폴더에서)
Expected: `ModuleNotFoundError: No module named 'publish_member_prices'`

- [ ] **Step 3: 구현** — `publish_member_prices.py`

```python
"""
publish_member_prices.py
market_cache의 최신 거래일 전 종목 종가·20일선을 public.member_prices에 올린다(회원 기록장 현재가 공급).
입력은 시세뿐이다 - 회원 데이터·회장님 원장은 읽지도 쓰지도 않는다.

실행:  python publish_member_prices.py [--dry-run]
"""
import glob
import os
import re
import sys

import pandas as pd

import supabase_client

KEEP_DAYS = 20


def build_rows(frames):
    """frames: 오래된 날 → 최신 날 순서의 DataFrame 목록. 최신 프레임의 종목마다 한 행을 만든다."""
    if not frames:
        return []
    all_df = pd.concat(frames, ignore_index=True)
    all_df["종목코드"] = all_df["종목코드"].astype(str).str.zfill(6)
    all_df["현재가"] = pd.to_numeric(all_df["현재가"], errors="coerce")
    latest = frames[-1]
    rows = []
    for _, r in latest.iterrows():
        code = str(r["종목코드"]).zfill(6)
        close = pd.to_numeric(pd.Series([r["현재가"]]), errors="coerce").iloc[0]
        if not re.fullmatch(r"\d{6}", code) or pd.isna(close) or close <= 0:
            continue
        series = all_df.loc[all_df["종목코드"] == code, "현재가"].dropna()
        ma20 = float(series.tail(KEEP_DAYS).mean()) if len(series) >= KEEP_DAYS else None
        day = str(r["일자"])
        rows.append({
            "stock_code": code,
            "stock_name": str(r.get("종목명", "")) or None,
            "market": str(r.get("시장구분", "")) or None,
            "close": float(close),
            "ma20": ma20,
            "trade_date": f"{day[:4]}-{day[4:6]}-{day[6:8]}",
        })
    return rows


def load_frames():
    files = sorted(glob.glob(os.path.join("market_cache", "*.csv")))[-KEEP_DAYS:]
    return [pd.read_csv(f, dtype={"종목코드": str}) for f in files]


def main():
    rows = build_rows(load_frames())
    if not rows:
        print("올릴 시세가 없습니다.")
        return 1
    if "--dry-run" in sys.argv:
        print(f"[미리보기] {len(rows)}종목, 기준일 {rows[0]['trade_date']}")
        return 0
    ok = True
    for i in range(0, len(rows), 500):          # 500행씩 나눠 보낸다
        ok = supabase_client._upsert("member_prices", rows[i:i + 500], "stock_code", schema="public") and ok
    print(f"member_prices upsert {'완료' if ok else '실패'}: {len(rows)}종목, 기준일 {rows[0]['trade_date']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
```

(**주의:** `supabase_client._upsert`는 `schema`를 안 주면 `stock_screener` 스키마에 쓴다. 회원 표는 `public`이므로 반드시 `schema="public"`를 넘긴다 — 위 코드에 반영돼 있다. `market_cache` CSV의 열은 `일자,종목코드,isin,종목명,시장구분,현재가,전일대비,fltRt,시가,고가,저가,거래량,거래대금,...`로 확인했다(2026-10-19). `_sanitize`가 nan/inf를 `None`으로 바꾸므로 지표 열의 `None`은 그대로 올라간다.)

- [ ] **Step 4: 통과 확인**

Run: `python -m unittest test_publish_member_prices -v`
Expected: 3 tests OK

- [ ] **Step 5: 실제 업로드 전 미리보기 → 업로드**

Run: `python publish_member_prices.py --dry-run` → 종목 수(약 2,800)와 기준일 확인 → `python publish_member_prices.py`
Expected: `member_prices upsert 완료`. 검증: MCP `execute_sql: select count(*), max(trade_date) from public.member_prices;`

- [ ] **Step 6: 예약 작업 체인에 추가**

Run: `schtasks /query /tn TrendDailyCheck /xml` 로 실행 명령 확인 → 같은 체인 끝에 `python publish_member_prices.py` 추가 → 수동으로 한 번 실행해 로그 확인
Expected: 작업 실행 후 `member_prices.updated_at`이 갱신됨

- [ ] **Step 7: Commit** (stock_screener 저장소 — 이번 작업 파일만 add)

```bash
git add publish_member_prices.py test_publish_member_prices.py
git commit -m "feat: 회원 기록장용 전 종목 종가·20일선 공급 스크립트"
```

---

### Task 6: 메뉴 노출 (index.html)

**Files:**
- Modify: `index.html` — 기존 `updateNav(user)` 함수와 로그인 후 호출부

- [ ] **Step 1:** `updateNav`에서 로그인 상태일 때 `member_feature_access`를 조회해 `holdings_enabled`이면 상단 메뉴에 "My page" 링크(`/mypage.html`)를 보이게 한다. 조회 실패·미허용이면 링크를 만들지 않는다(조용히 숨김).

```javascript
async function refreshMyPageLink(user) {
  var el = document.getElementById('nav-mypage');
  if (!el) return;
  el.style.display = 'none';
  if (!user) return;
  try {
    var r = await sb.from('member_feature_access').select('holdings_enabled').eq('user_id', user.id).maybeSingle();
    if (r.data && r.data.holdings_enabled) el.style.display = '';
  } catch (e) {}
}
```

- [ ] **Step 2: 확인** — 허용 계정 로그인 시 메뉴에 링크 노출, 미허용·비로그인은 미노출, 링크 클릭 시 `mypage.html`에서 기록장이 열림

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: 허용 회원에게만 My page 메뉴 노출"
```

---

### Task 9A: 차트 위치 지표·뉴스 공급 (DB + PC)

**Files:**
- Create: `db/004_member_chart_news.sql`
- Modify: `E:\AI\프로젝트\만조 로드맵\stock_screener\supabase_client.py` (함수 1개 추가)
- Modify: `E:\AI\프로젝트\만조 로드맵\stock_screener\publish_member_prices.py` (지표 열 추가)
- Modify: `E:\AI\프로젝트\만조 로드맵\stock_screener\test_publish_member_prices.py`
- Create: `E:\AI\프로젝트\만조 로드맵\stock_screener\publish_member_stock_detail.py`
- Create: `E:\AI\프로젝트\만조 로드맵\stock_screener\test_publish_member_stock_detail.py`

**Interfaces:**
- Consumes: Task 1의 `public.member_prices`, `public.member_has_holdings_access()`; Task 8의 `public.member_held_codes() returns text[]`(service role 전용, **종목코드만** 돌려준다 — 누가 들고 있는지는 알 수 없다); `news_client.get_recent_news_items(item_code, stock_name, count, lookback_days) -> list[{"title","link","source","published_at"}]`.
- Produces: `member_prices` 새 열 `ma5, ma60, ma120, high_52w, low_52w`; 표 `public.member_stock_detail(stock_code pk, closes jsonb, news jsonb, updated_at)` — `closes`는 `[{"d":"2026-10-19","c":123000}, ...]` 최근 60거래일, `news`는 `[{"title","link","source","date"}]` 최대 8건; `supabase_client.rpc(name: str, params: dict, schema: str = "public") -> object|None`; `publish_member_prices.build_rows(frames)`의 행에 위 5개 키 추가(데이터가 모자라면 `None`).

- [ ] **Step 1: 마이그레이션 작성·적용** — `db/004_member_chart_news.sql`

```sql
alter table public.member_prices
  add column if not exists ma5 numeric,
  add column if not exists ma60 numeric,
  add column if not exists ma120 numeric,
  add column if not exists high_52w numeric,
  add column if not exists low_52w numeric;

create table if not exists public.member_stock_detail (
  stock_code text primary key check (stock_code ~ '^[0-9]{6}$'),
  closes jsonb not null default '[]'::jsonb,
  news jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.member_stock_detail enable row level security;
drop policy if exists "detail read" on public.member_stock_detail;
create policy "detail read" on public.member_stock_detail for select to authenticated
  using (public.member_has_holdings_access());
```

Run: MCP `apply_migration`(name: `member_chart_news`) → `execute_sql: select column_name from information_schema.columns where table_name='member_prices' and column_name in ('ma5','ma60','ma120','high_52w','low_52w');`
Expected: 5행

- [ ] **Step 2: 지표 테스트 추가** — `test_publish_member_prices.py`에 추가

```python
class IndicatorTest(unittest.TestCase):
    def test_long_history_indicators(self):
        frames = [frame(f"2026{(i // 28) + 1:02d}{(i % 28) + 1:02d}", 1000 + i) for i in range(252)]
        r = p.build_rows(frames)[0]
        closes = [1000 + i for i in range(252)]
        self.assertAlmostEqual(r["ma5"], sum(closes[-5:]) / 5)
        self.assertAlmostEqual(r["ma60"], sum(closes[-60:]) / 60)
        self.assertAlmostEqual(r["ma120"], sum(closes[-120:]) / 120)
        self.assertEqual(r["high_52w"], max(closes))
        self.assertEqual(r["low_52w"], min(closes))

    def test_short_history_gives_none(self):
        frames = [frame(f"202610{d:02d}", 100 + d) for d in range(1, 31)]   # 30일
        r = p.build_rows(frames)[0]
        self.assertIsNotNone(r["ma20"])
        self.assertIsNone(r["ma60"])
        self.assertIsNone(r["ma120"])
        self.assertIsNone(r["high_52w"])      # 52주 지표는 200거래일 이상일 때만
```

Run: `python -m unittest test_publish_member_prices -v`
Expected: FAIL (`KeyError: 'ma5'`)

- [ ] **Step 3: 구현** — `publish_member_prices.py`의 `KEEP_DAYS`와 `build_rows`를 수정

```python
KEEP_DAYS = 252          # 52주 지표까지 계산하려고 최근 252거래일을 읽는다
MIN_52W_DAYS = 200


def _avg(series, n):
    return float(series.tail(n).mean()) if len(series) >= n else None
```

`build_rows`의 종목 루프 안에서 `series = ...` 다음 두 줄(`ma20 = ...`)을 아래로 교체한다:

```python
        series = all_df.loc[all_df["종목코드"] == code, "현재가"].dropna()
        ma20 = _avg(series, 20)
        row_extra = {
            "ma5": _avg(series, 5),
            "ma60": _avg(series, 60),
            "ma120": _avg(series, 120),
            "high_52w": float(series.max()) if len(series) >= MIN_52W_DAYS else None,
            "low_52w": float(series.min()) if len(series) >= MIN_52W_DAYS else None,
        }
```

그리고 `rows.append({...})`의 dict 끝에 `**row_extra`를 추가한다. (기존 20일선 계산은 `KEEP_DAYS` 상수 대신 `_avg(series, 20)`로 바뀐다. 기존 테스트 `test_close_and_ma20`가 그대로 통과해야 한다.)

Run: `python -m unittest test_publish_member_prices -v`
Expected: 기존 3 + 신규 2 = 5 tests OK

- [ ] **Step 4: `rpc` 헬퍼 추가** — `supabase_client.py`의 `select()` 함수 위에 추가

```python
def rpc(name: str, params: dict = None, schema: str = "public"):
    """PostgREST RPC(함수 호출). 실패하면 None. 서버 쪽 함수가 service_role만 실행하게 막혀 있으므로
    이 키로만 호출된다."""
    if not is_enabled():
        return None
    url = f"{config.SUPABASE_URL.rstrip('/')}/rest/v1/rpc/{name}"
    try:
        resp = requests.post(url, headers=_headers(schema), json=params or {},
                             timeout=getattr(config, "SUPABASE_REQUEST_TIMEOUT_SEC", 15))
        if resp.status_code >= 300:
            logger.warning(f"[Supabase] rpc {name} 실패 ({resp.status_code}): {resp.text[:300]}")
            return None
        return resp.json()
    except requests.exceptions.RequestException as e:
        logger.warning(f"[Supabase] rpc {name} 네트워크 오류(건너뜀): {e}")
        return None
```

- [ ] **Step 5: 종목 상세 공급 테스트** — `test_publish_member_stock_detail.py`

```python
import unittest
from datetime import datetime, timezone
import pandas as pd
import publish_member_stock_detail as d


def day(i):
    return f"2026{(i // 28) + 1:02d}{(i % 28) + 1:02d}"


class ClosesTest(unittest.TestCase):
    def test_last_60_closes_in_order(self):
        frames = [pd.DataFrame([{"종목코드": "005930", "현재가": 100 + i, "일자": day(i)}]) for i in range(80)]
        out = d.closes_for("005930", frames)
        self.assertEqual(len(out), 60)
        self.assertEqual(out[-1]["c"], 179)
        self.assertEqual(out[0]["c"], 120)
        self.assertRegex(out[0]["d"], r"^\d{4}-\d{2}-\d{2}$")

    def test_unknown_code_is_empty(self):
        frames = [pd.DataFrame([{"종목코드": "000660", "현재가": 1, "일자": "20261001"}])]
        self.assertEqual(d.closes_for("005930", frames), [])


class NewsTest(unittest.TestCase):
    def test_keeps_only_http_links_and_formats_date(self):
        items = [
            {"title": "A사 신제품 공개", "link": "https://n.news.naver.com/x", "source": "네이버",
             "published_at": datetime(2026, 10, 19, 1, 0, tzinfo=timezone.utc)},
            {"title": "나쁜 링크", "link": "javascript:alert(1)", "source": "x", "published_at": None},
        ]
        out = d.format_news(items)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["title"], "A사 신제품 공개")
        self.assertEqual(out[0]["date"], "2026-10-19")

    def test_caps_at_8(self):
        items = [{"title": f"t{i}", "link": f"https://e.com/{i}", "source": "s", "published_at": None} for i in range(20)]
        self.assertEqual(len(d.format_news(items)), 8)


if __name__ == "__main__":
    unittest.main()
```

Run: `python -m unittest test_publish_member_stock_detail -v`
Expected: `ModuleNotFoundError: No module named 'publish_member_stock_detail'`

- [ ] **Step 6: 구현** — `publish_member_stock_detail.py`

```python
"""
publish_member_stock_detail.py
회원 보유·관찰 종목(코드만 조회)의 최근 60일 종가와 뉴스 헤드라인을 public.member_stock_detail에 올린다.
- 누가 어떤 종목을 들고 있는지는 알 수 없다: member_held_codes()는 종목코드 배열만 돌려준다.
- 뉴스는 제목·출처·날짜·링크만, 모든 회원에게 같은 목록이다. 호재/악재 판정·감성 점수는 붙이지 않는다.

실행:  python publish_member_stock_detail.py [--dry-run]
"""
import glob
import logging
import os
import sys

import pandas as pd

import supabase_client

logger = logging.getLogger(__name__)
NEWS_MAX = 8
CLOSES_DAYS = 60


def closes_for(code, frames):
    out = []
    for f in frames[-CLOSES_DAYS:]:
        codes = f["종목코드"].astype(str).str.zfill(6)
        row = f[codes == code]
        if row.empty:
            continue
        price = pd.to_numeric(row["현재가"], errors="coerce").iloc[0]
        day = str(row["일자"].iloc[0])
        if pd.isna(price):
            continue
        out.append({"d": f"{day[:4]}-{day[4:6]}-{day[6:8]}", "c": float(price)})
    return out


def format_news(items):
    out = []
    for it in items:
        link = str(it.get("link") or "")
        if not link.startswith(("http://", "https://")):
            continue
        ts = it.get("published_at")
        out.append({
            "title": str(it.get("title") or "")[:200],
            "link": link,
            "source": str(it.get("source") or "")[:40],
            "date": ts.astimezone().strftime("%Y-%m-%d") if ts is not None else None,
        })
        if len(out) >= NEWS_MAX:
            break
    return out


def load_frames():
    files = sorted(glob.glob(os.path.join("market_cache", "*.csv")))[-CLOSES_DAYS:]
    return [pd.read_csv(f, dtype={"종목코드": str}) for f in files]


def main():
    codes = supabase_client.rpc("member_held_codes", {})
    if codes is None:
        print("보유 종목 코드를 가져오지 못했습니다.")
        return 1
    if not codes:
        print("회원 보유 종목이 없어 올릴 것이 없습니다.")
        return 0
    frames = load_frames()
    names = {}
    if frames:
        last = frames[-1]
        names = dict(zip(last["종목코드"].astype(str).str.zfill(6), last["종목명"]))
    import news_client
    rows = []
    for code in codes:
        try:
            items = news_client.get_recent_news_items(code, names.get(code, ""), count=NEWS_MAX, lookback_days=14)
        except Exception as e:
            logger.warning(f"{code} 뉴스 조회 실패(뉴스 없이 진행): {e}")
            items = []
        rows.append({"stock_code": code, "closes": closes_for(code, frames), "news": format_news(items)})
    if "--dry-run" in sys.argv:
        print(f"[미리보기] {len(rows)}종목, 뉴스 {sum(len(r['news']) for r in rows)}건")
        return 0
    ok = supabase_client._upsert("member_stock_detail", rows, "stock_code", schema="public")
    print(f"member_stock_detail upsert {'완료' if ok else '실패'}: {len(rows)}종목")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
```

Run: `python -m unittest test_publish_member_stock_detail -v`
Expected: 4 tests OK

- [ ] **Step 7: 예약 작업 체인** — Task 5 Step 6의 같은 체인 끝에 `python publish_member_stock_detail.py`를 `publish_member_prices.py` 다음에 추가한다. 수동 실행 뒤 `execute_sql: select stock_code, jsonb_array_length(news) from public.member_stock_detail;`로 확인(Task 8의 `member_held_codes`가 적용된 뒤에만 실행 가능).

- [ ] **Step 8: Commit**

```bash
# 사이트 저장소
git add db/004_member_chart_news.sql && git commit -m "feat: 회원 기록장 차트 지표·뉴스 저장 표 추가"
# stock_screener 저장소 (이번 작업 파일만 add)
git add supabase_client.py publish_member_prices.py test_publish_member_prices.py publish_member_stock_detail.py test_publish_member_stock_detail.py
git commit -m "feat: 회원 기록장용 이동평균·52주 지표와 종목별 60일 종가·뉴스 공급"
```

---

### Task 9B: 차트 위치 사실 요약 + 뉴스 패널 (계산 + 화면)

**Files:**
- Modify: `lib/holdings-calc.js` (함수 1개 추가)
- Modify: `test/holdings-calc.test.js`
- Modify: `mypage.html` (행 펼침 패널)

**Interfaces:**
- Produces: `HoldingsCalc.chartPosition(price)` → `{ alignment: '정배열'|'역배열'|'혼조'|null, vs: { ma5, ma20, ma60, ma120, high52, low52 } }` (각 값은 % 숫자, 계산 불가면 `null`). `price`는 `{close, ma5, ma20, ma60, ma120, high_52w, low_52w}`(숫자 또는 숫자 문자열) 또는 `null`.
  - `vs.maN` = `(close/maN - 1) * 100`, `vs.high52` = `(close/high_52w - 1) * 100`(0 이하), `vs.low52` = `(close/low_52w - 1) * 100`(0 이상).
  - `alignment`: `ma5 > ma20 > ma60`이면 `정배열`, `ma5 < ma20 < ma60`이면 `역배열`, 셋 중 하나라도 없으면 `null`, 나머지는 `혼조`.
- Consumes: Task 4의 `state.prices`(select 열을 `stock_code, close, ma5, ma20, ma60, ma120, high_52w, low_52w, trade_date`로 넓힌다), Task 9A의 `member_stock_detail`.

- [ ] **Step 1: 실패하는 테스트 추가** — `test/holdings-calc.test.js` 끝에

```javascript
const { chartPosition } = require('../lib/holdings-calc.js');

test('차트 위치: 정배열과 이동평균·52주 대비', () => {
  const c = chartPosition({ close: 110, ma5: 108, ma20: 100, ma60: 90, ma120: 80, high_52w: 120, low_52w: 50 });
  assert.equal(c.alignment, '정배열');
  assert.equal(c.vs.ma20, 10);
  assert.ok(Math.abs(c.vs.high52 - (-8.3333)) < 0.001);
  assert.equal(c.vs.low52, 120);
});

test('차트 위치: 역배열과 혼조', () => {
  assert.equal(chartPosition({ close: 70, ma5: 72, ma20: 80, ma60: 90 }).alignment, '역배열');
  assert.equal(chartPosition({ close: 100, ma5: 95, ma20: 100, ma60: 90 }).alignment, '혼조');
});

test('차트 위치: 값이 없으면 null (추측하지 않는다)', () => {
  const c = chartPosition({ close: 100, ma5: 99, ma20: 98, ma60: null, ma120: null, high_52w: null, low_52w: null });
  assert.equal(c.alignment, null);
  assert.equal(c.vs.ma60, null);
  assert.equal(c.vs.high52, null);
  assert.equal(chartPosition(null).alignment, null);
});
```

Run: `node --test test/holdings-calc.test.js`
Expected: FAIL (`chartPosition is not a function`)

- [ ] **Step 2: 구현** — `lib/holdings-calc.js`에서 `const api = { summarize: summarize, totals: totals };` 줄을 아래 블록으로 교체

```javascript
  function chartPosition(price) {
    const empty = { alignment: null, vs: { ma5: null, ma20: null, ma60: null, ma120: null, high52: null, low52: null } };
    if (!price) return empty;
    const close = num(price.close);
    if (close === null) return empty;
    const rel = function (base) { const b = num(base); return b ? (close / b - 1) * 100 : null; };
    const m5 = num(price.ma5), m20 = num(price.ma20), m60 = num(price.ma60);
    let alignment = null;
    if (m5 !== null && m20 !== null && m60 !== null) {
      alignment = m5 > m20 && m20 > m60 ? '정배열' : (m5 < m20 && m20 < m60 ? '역배열' : '혼조');
    }
    return { alignment: alignment, vs: {
      ma5: rel(price.ma5), ma20: rel(price.ma20), ma60: rel(price.ma60), ma120: rel(price.ma120),
      high52: rel(price.high_52w), low52: rel(price.low_52w),
    } };
  }
  const api = { summarize: summarize, totals: totals, chartPosition: chartPosition };
```

Run: `node --test test/holdings-calc.test.js`
Expected: PASS (기존 7 + 신규 3 = 10)

- [ ] **Step 3: mypage.html 패널** — 보유 행 클릭 시 행 아래에 패널을 펼친다(상태 드롭다운·체크박스·버튼 클릭은 펼침에서 제외). 다시 누르면 접는다.

```javascript
async function openDetail(h, price, holdingRowEl) {
  const next = holdingRowEl.nextElementSibling;
  if (next && next.classList.contains('detail-row')) { next.remove(); return; }
  const tr = document.createElement('tr');
  tr.className = 'detail-row';
  tr.innerHTML = '<td colspan="9">불러오는 중…</td>';
  holdingRowEl.after(tr);
  const d = await sb.from('member_stock_detail').select('closes, news, updated_at').eq('stock_code', h.stock_code).maybeSingle();
  const pos = HoldingsCalc.chartPosition(price);
  const f = (v) => (v === null ? '-' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
  const closes = d.data ? d.data.closes : [];
  const news = d.data ? d.data.news : [];
  const safeUrl = (u) => (/^https?:\/\//.test(u) ? u : '#');
  tr.innerHTML = '<td colspan="9"><div class="detail">'
    + '<div class="detail-chart">' + sparkSvg(closes, Number(h.avg_price)) + '<div class="note">실선: 최근 60거래일 종가 · 점선: 내 평균단가</div></div>'
    + '<div class="detail-pos"><h4>차트 위치 (사실 수치)</h4><ul>'
    + '<li>이동평균 배열: ' + esc(pos.alignment || '데이터 부족') + '</li>'
    + '<li>5일선 대비 ' + f(pos.vs.ma5) + ' · 20일선 대비 ' + f(pos.vs.ma20) + '</li>'
    + '<li>60일선 대비 ' + f(pos.vs.ma60) + ' · 120일선 대비 ' + f(pos.vs.ma120) + '</li>'
    + '<li>52주 고점 대비 ' + f(pos.vs.high52) + ' · 52주 저점 대비 ' + f(pos.vs.low52) + '</li>'
    + '</ul></div>'
    + '<div class="detail-news"><h4>관련 뉴스</h4>'
    + (news.length ? '<ul>' + news.map((n) => '<li><a href="' + esc(safeUrl(n.link)) + '" target="_blank" rel="noopener noreferrer">' + esc(n.title) + '</a> <span class="note">' + esc(n.source || '') + (n.date ? ' · ' + esc(n.date) : '') + '</span></li>').join('') + '</ul>' : '<p class="note">표시할 뉴스가 없습니다.</p>')
    + '<p class="note">뉴스 목록은 종목 기준으로 모든 회원에게 동일하게 제공되며, 내용에 대한 평가나 투자 의견이 아닙니다.</p></div>'
    + '</div></td>';
}

function sparkSvg(closes, avgPrice) {
  if (!closes || closes.length < 2) return '<p class="note">차트 데이터를 준비 중입니다.</p>';
  const W = 320, H = 110, P = 6;
  const vals = closes.map((x) => x.c).concat([avgPrice]);
  const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  const x = (i) => P + (i * (W - 2 * P)) / (closes.length - 1);
  const y = (v) => H - P - ((v - lo) * (H - 2 * P)) / ((hi - lo) || 1);
  const pts = closes.map((c, i) => x(i).toFixed(1) + ',' + y(c.c).toFixed(1)).join(' ');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="최근 60거래일 종가 추이">'
    + '<polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.6"/>'
    + '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + y(avgPrice).toFixed(1) + '" y2="' + y(avgPrice).toFixed(1) + '" stroke="currentColor" stroke-dasharray="4 3" opacity=".6"/></svg>';
}
```

`.detail`은 3열 그리드(데스크톱), 700px 이하에서 1열로 쌓는다. 뉴스 제목은 반드시 `esc()`, 링크는 `safeUrl()`을 거친다.

- [ ] **Step 4: 브라우저 검증**

Run: `python -m http.server 3000` → mypage.html에서 보유 행 클릭
Expected: 스파크라인(평균단가 점선 포함), 차트 위치 4줄, 뉴스 목록(새 탭 링크), 안내 문구가 보인다. 시세·상세 데이터가 없는 종목은 "데이터 부족/준비 중/뉴스 없음"으로 표시되고 오류가 없다. 375px에서 패널이 1열로 쌓이고 페이지 가로 스크롤이 없다. 화면 어디에도 매수·매도·추천·평가 문구가 없다(문구 전수 확인).

- [ ] **Step 5: Commit**

```bash
git add lib/holdings-calc.js test/holdings-calc.test.js mypage.html
git commit -m "feat: 회원 기록장에 차트 위치 사실 수치와 종목 뉴스 패널 추가"
```

---

### Task 8: 익명 매매 통계 (회원과 연결되지 않는 집계)

**Files:**
- Create: `db/003_member_anon_stats.sql`
- Create: `db/003_member_anon_stats_test.sql`
- Create: `api/admin-member-stats.js`
- Modify: `admin.html` (섹션 "회원 매매 통계(익명)" 추가)

**Interfaces:**
- Consumes: Task 1의 `public.member_holdings`, `public.member_holding_sales`, `public.member_sell`.
- Produces:
  - 표 `public.member_trade_stats(id uuid pk, stock_code, stock_name, entry_month 'YYYY-MM', exit_month 'YYYY-MM', hold_days int, entry_price numeric, exit_price numeric(가중평균 매도가), return_pct numeric, sell_count int)` — **user_id·holding_id·정확한 날짜·수량 열이 없다.** RLS 켬, 정책 없음, `anon`/`authenticated` 권한 회수(service role과 DB 트리거만 접근).
  - 트리거 `member_record_trade_stat`: 보유 행이 `closed`로 바뀌는 순간 1건 기록(매도 기록이 없으면 기록 안 함). 회원이 나중에 기록을 지워도 통계 행은 남는다(이미 익명이며 Task 7에서 처리방침에 명시).
  - `public.member_stats_summary(p_min_n int default 3) returns jsonb` / `public.member_open_aggregate(p_min_n int default 3) returns jsonb` / `public.member_held_codes() returns text[]` — 모두 **service_role만 실행**.
  - `GET /api/admin-member-stats?minN=3` → `{ summary, open, accessCount }`.

- [ ] **Step 1: 테스트 먼저** — `db/003_member_anon_stats_test.sql`

```sql
begin;
  insert into auth.users (id, instance_id, aud, role, email) values
   ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@test.invalid'),
   ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@test.invalid'),
   ('cccccccc-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@test.invalid');
  insert into public.member_feature_access (user_id, holdings_enabled) values
   ('aaaaaaaa-0000-0000-0000-000000000001', true),
   ('bbbbbbbb-0000-0000-0000-000000000002', true),
   ('cccccccc-0000-0000-0000-000000000003', true);

  do $$
  declare u uuid; hid uuid; n0 int; n1 int; s jsonb;
  begin
    select count(*) into n0 from public.member_trade_stats;
    -- 3명이 같은 종목(005930)을 사서 분할 매도 후 전량 청산
    for u in select unnest(array['aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003']::uuid[]) loop
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
      values (u, '005930', '삼성전자', 'open', 70000, 10, 10, '2026-09-01') returning id into hid;
      perform public.member_sell(hid, 4, 75000, '2026-09-20');   -- 분할 매도 단계: 통계 행이 생기면 안 된다
      select count(*) into n1 from public.member_trade_stats;
      if n1 <> n0 then raise exception 'FAIL: 분할 매도 단계에서 통계 행이 생김'; end if;
      perform public.member_sell(hid, null, 80000, '2026-10-05'); -- 전량 청산 → 1건
      n0 := n1 + 1;
    end loop;
    -- 한 명이 다른 종목(000660)도 청산: 이 종목은 1건뿐이라 집계에서 숨겨져야 한다
    perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
    insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '000660', 'SK하이닉스', 'open', 100000, 1, 1, '2026-09-01') returning id into hid;
    perform public.member_sell(hid, null, 90000, '2026-10-06');

    -- 익명성: 통계 표에는 회원·보유를 가리키는 열이 없다
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='member_trade_stats'
                  and column_name in ('user_id','holding_id','quantity','initial_qty','sold_on','closed_on','entry_date','created_at')) then
      raise exception 'FAIL: 통계 표에 식별 가능한 열이 있음';
    end if;

    s := public.member_stats_summary(3);
    if not exists (select 1 from jsonb_array_elements(s->'by_stock') e where e->>'stock_code'='005930') then
      raise exception 'FAIL: 3건 종목이 집계에서 빠짐'; end if;
    if exists (select 1 from jsonb_array_elements(s->'by_stock') e where e->>'stock_code'='000660') then
      raise exception 'FAIL: 1건 종목이 노출됨'; end if;
    -- 최소 표본(100)보다 적으면 전체 값도 숨긴다
    s := public.member_stats_summary(100);
    if (s->'overall') is not null and (s->'overall') <> 'null'::jsonb then
      raise exception 'FAIL: 표본 부족인데 전체 통계가 노출됨'; end if;
    -- 보유 집계는 3명 미만 종목을 숨기고, 코드 목록 함수는 코드만 돌려준다
    insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '035720', '카카오', 'open', 50000, 1, 1, '2026-09-01');
    if exists (select 1 from jsonb_array_elements(public.member_open_aggregate(3)) e where e->>'stock_code'='035720') then
      raise exception 'FAIL: 1명 보유 종목이 보유 집계에 노출됨'; end if;
    if not ('035720' = any(public.member_held_codes())) then raise exception 'FAIL: 보유 코드 목록 누락'; end if;
  end $$;

  -- 일반 로그인 회원은 통계 표·집계 함수에 접근할 수 없다
  set local role authenticated;
  do $$
  begin
    begin perform count(*) from public.member_trade_stats;
      raise exception 'FAIL: 회원이 통계 표를 읽음';
    exception when insufficient_privilege then null; end;
    begin perform public.member_stats_summary(3);
      raise exception 'FAIL: 회원이 집계 함수를 실행함';
    exception when insufficient_privilege then null; end;
    begin perform public.member_held_codes();
      raise exception 'FAIL: 회원이 코드 목록 함수를 실행함';
    exception when insufficient_privilege then null; end;
  end $$;
rollback;
```

Run: `execute_sql`로 위 파일
Expected: 실패 (`relation "public.member_trade_stats" does not exist`)

- [ ] **Step 2: 마이그레이션** — `db/003_member_anon_stats.sql`

```sql
create table if not exists public.member_trade_stats (
  id uuid primary key default gen_random_uuid(),   -- 무작위 키: 생성 순서로 회원을 추측하지 못하게 한다
  stock_code text not null check (stock_code ~ '^[0-9]{6}$'),
  stock_name text,
  entry_month text not null check (entry_month ~ '^[0-9]{4}-[0-9]{2}$'),
  exit_month text not null check (exit_month ~ '^[0-9]{4}-[0-9]{2}$'),
  hold_days integer not null check (hold_days >= 0),
  entry_price numeric not null check (entry_price > 0),
  exit_price numeric not null check (exit_price > 0),
  return_pct numeric not null,
  sell_count integer not null check (sell_count >= 1)
);
alter table public.member_trade_stats enable row level security;
revoke all on table public.member_trade_stats from anon, authenticated;

create or replace function public.member_record_trade_stat() returns trigger
language plpgsql security definer set search_path = public as $$
declare q numeric; w numeric; c int; closed date;
begin
  select coalesce(sum(qty), 0), coalesce(sum(qty * price), 0), count(*)
    into q, w, c from public.member_holding_sales where holding_id = new.id;
  if c = 0 or q = 0 then return new; end if;
  closed := coalesce(new.closed_on, current_date);
  insert into public.member_trade_stats
    (stock_code, stock_name, entry_month, exit_month, hold_days, entry_price, exit_price, return_pct, sell_count)
  values (new.stock_code, new.stock_name, to_char(new.entry_date, 'YYYY-MM'), to_char(closed, 'YYYY-MM'),
          greatest(closed - new.entry_date, 0), new.avg_price, w / q, (w / q / new.avg_price - 1) * 100, c);
  return new;
end $$;
revoke all on function public.member_record_trade_stat() from public, anon, authenticated;

drop trigger if exists member_record_trade_stat_trg on public.member_holdings;
create trigger member_record_trade_stat_trg
  after update of status on public.member_holdings
  for each row when (old.status <> 'closed' and new.status = 'closed')
  execute function public.member_record_trade_stat();

create or replace function public.member_stats_summary(p_min_n int default 3) returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (select * from public.member_trade_stats),
  tot as (select count(*)::int as n from t),
  overall as (
    select count(*)::int as n,
           round(avg(hold_days)::numeric, 1) as avg_hold_days,
           round((percentile_cont(0.5) within group (order by hold_days))::numeric, 1) as median_hold_days,
           round(avg(return_pct)::numeric, 2) as avg_return_pct,
           round((percentile_cont(0.5) within group (order by return_pct))::numeric, 2) as median_return_pct,
           round(100.0 * count(*) filter (where return_pct > 0) / nullif(count(*), 0), 1) as win_rate_pct
      from t),
  by_stock as (
    select stock_code, max(stock_name) as stock_name, count(*)::int as n,
           round(avg(hold_days)::numeric, 1) as avg_hold_days,
           round(avg(return_pct)::numeric, 2) as avg_return_pct,
           round(avg(entry_price), 0) as avg_entry_price,
           round(avg(exit_price), 0) as avg_exit_price
      from t group by stock_code having count(*) >= greatest(p_min_n, 3)),
  hb as (select case when hold_days <= 7 then '1주 이하' when hold_days <= 30 then '1개월 이하'
                     when hold_days <= 90 then '3개월 이하' when hold_days <= 365 then '1년 이하' else '1년 초과' end as bucket,
                count(*)::int as n from t group by 1),
  rb as (select case when return_pct < -20 then '-20% 미만' when return_pct < -7 then '-20~-7%'
                     when return_pct < 0 then '-7~0%' when return_pct < 10 then '0~10%'
                     when return_pct < 30 then '10~30%' else '30% 이상' end as bucket,
                count(*)::int as n from t group by 1)
  select jsonb_build_object(
    'min_n', greatest(p_min_n, 3),
    'total_trades', (select n from tot),
    'overall', case when (select n from tot) >= greatest(p_min_n, 3) then (select to_jsonb(overall) from overall) else null end,
    'by_stock', coalesce((select jsonb_agg(to_jsonb(by_stock) order by n desc) from by_stock), '[]'::jsonb),
    'hold_buckets', case when (select n from tot) >= greatest(p_min_n, 3) then coalesce((select jsonb_agg(to_jsonb(hb)) from hb), '[]'::jsonb) else '[]'::jsonb end,
    'return_buckets', case when (select n from tot) >= greatest(p_min_n, 3) then coalesce((select jsonb_agg(to_jsonb(rb)) from rb), '[]'::jsonb) else '[]'::jsonb end);
$$;

create or replace function public.member_open_aggregate(p_min_n int default 3) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.holders desc), '[]'::jsonb) from (
    select stock_code, max(stock_name) as stock_name,
           count(distinct user_id)::int as holders,
           round(sum(avg_price * remaining_qty) / nullif(sum(remaining_qty), 0), 0) as avg_cost,
           round(avg(current_date - entry_date), 0) as avg_hold_days
      from public.member_holdings
     where status in ('open', 'watch')
     group by stock_code
    having count(distinct user_id) >= greatest(p_min_n, 3)) x;
$$;

create or replace function public.member_held_codes() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct stock_code), '{}') from public.member_holdings where status in ('open', 'watch');
$$;

-- 세 함수는 service_role만 실행한다. (Supabase는 새 함수를 기본적으로 anon/authenticated에도 실행 허용하므로 명시적으로 회수)
revoke all on function public.member_stats_summary(int) from public, anon, authenticated;
revoke all on function public.member_open_aggregate(int) from public, anon, authenticated;
revoke all on function public.member_held_codes() from public, anon, authenticated;
grant execute on function public.member_stats_summary(int) to service_role;
grant execute on function public.member_open_aggregate(int) to service_role;
grant execute on function public.member_held_codes() to service_role;
```

- [ ] **Step 3: 적용 후 테스트 통과 확인**

Run: MCP `apply_migration`(name: `member_anon_stats`) → `execute_sql`로 `003_member_anon_stats_test.sql`
Expected: 오류 없이 끝남(`FAIL:` 없음). 이후 `select count(*) from public.member_trade_stats;` → `0`(롤백됨).

- [ ] **Step 4: 관리자 API** — `api/admin-member-stats.js`

```javascript
// [관리자 전용] 회원 매매 익명 통계. member_holdings / member_holding_sales / user_id 는 읽지 않는다.
// 집계 함수(service_role 전용)의 결과만 돌려준다. 최소 표본은 서버에서 3 미만으로 내릴 수 없다.
const SUPABASE_URL = 'https://nxvpipgvcrfkujbvjjak.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dnBpcGd2Y3Jma3VqYnZqamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTA5NTAsImV4cCI6MjA5ODA4Njk1MH0.QXJs2t980WJ_tiXFsFFUWubftHb30r5IpoA1-09qBPk';

async function verifyAdmin(req) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const user = await r.json();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !user || !user.email) return null;
  return user.email.toLowerCase() === adminEmail.toLowerCase() ? user : null;
}

module.exports = async function handler(req, res) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: '서버 설정이 없습니다' });
  if (!(await verifyAdmin(req))) return res.status(403).json({ error: '관리자만 사용할 수 있습니다' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 지원합니다' });

  const minN = Math.min(Math.max(parseInt((req.query || {}).minN, 10) || 3, 3), 50);
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const call = (name) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify({ p_min_n: minN }) });
  const [a, b, c] = await Promise.all([
    call('member_stats_summary'),
    call('member_open_aggregate'),
    fetch(`${SUPABASE_URL}/rest/v1/member_feature_access?select=user_id&holdings_enabled=eq.true`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } }),
  ]);
  if (!a.ok || !b.ok) return res.status(502).json({ error: '통계를 불러오지 못했습니다' });
  const total = (c.headers.get('content-range') || '').split('/')[1];
  return res.status(200).json({ summary: await a.json(), open: await b.json(), accessCount: total ? Number(total) : null });
};
```

Run: `SUPABASE_SERVICE_ROLE_KEY=x node -e "require('./api/admin-member-stats.js')({method:'GET',headers:{}},{status:c=>({json:o=>console.log(c,o)})})"`
Expected: `403 { error: '관리자만 사용할 수 있습니다' }`

- [ ] **Step 5: 관리자 화면 섹션** — `admin.html`에 "회원 매매 통계(익명)" 섹션을 추가한다(기존 섹션 구조·CSS 재사용). `GET /api/admin-member-stats`를 호출해 그린다: 상단 안내문 "회원 개인·종목과 연결되지 않은 익명 집계입니다. 표본이 3건(보유는 3명) 미만인 항목은 표시하지 않습니다." / 카드(청산 건수, 평균·중앙 보유일, 평균·중앙 수익률, 승률) / 보유 기간 분포·수익률 분포(표) / 종목별 표(종목, 건수, 평균 매수가, 평균 매도가, 평균 보유일, 평균 수익률) / 현재 보유 집계 표(종목, 보유 회원 수, 평균 매수가, 평균 보유일). `summary.overall`이 `null`이면 카드 대신 "아직 집계에 필요한 표본이 부족합니다(현재 N건)"만 보인다(`N = summary.total_trades`). 모든 문자열은 `esc()`를 거친다. **이 섹션에는 회원 이름·이메일·ID가 어디에도 나오지 않는다.**

- [ ] **Step 6: 확인**

Run: 테스트 회원 계정으로 매매·청산을 만들어 통계 섹션이 표본 부족 문구를 보이는지, 3건 이상 쌓이면 집계가 나오는지 확인
Expected: 화면과 네트워크 응답 어디에도 user_id·이메일이 없다(`read_network_requests`로 응답 본문 확인). 테스트로 생긴 통계 행의 삭제 여부는 회장님께 확인한 뒤 처리한다(통계 행은 회원이 지울 수 없다).

- [ ] **Step 7: Commit**

```bash
git add db/003_member_anon_stats.sql db/003_member_anon_stats_test.sql api/admin-member-stats.js admin.html
git commit -m "feat: 회원 매매 익명 통계(표·트리거·집계 함수·관리자 화면) 추가"
```

---

### Task 7: 공개 전 관문 (코드가 아닌 체크리스트 — 통과 전에는 실제 회원에게 열지 않는다)

- [ ] **7-1. 법률 확인 요청서 작성**: "회원이 직접 입력한 보유 종목에 대해 평가손익·20일선 대비 같은 사실만 표시하고, 매매 신호·알림·코멘트는 제공하지 않는 기록장"이 투자자문/유사투자자문 신고 범위에 해당하는지 변호사에게 문의(기존 문서 `만조사이트_회원서비스_아키텍처_및_법률검토.md`, `유사투자자문업_법률검토_참고자료.md`를 첨부). **회신 전까지 허용 회원은 회장님 본인 테스트 계정으로만 둔다.**
- [ ] **7-2. 개인정보 처리**: 회원 보유 종목은 민감한 개인정보에 준해 다룬다. 개인정보 처리방침에 "보유 종목 기록 수집·이용 목적·보관 기간·탈퇴 시 삭제"를 추가하고, My page에 첫 이용 시 동의 문구를 넣을지 결정한다.
- [ ] **7-3. 운영자 열람 정책 확정(2026-10-19 회장님 결정 반영)**: 회장님은 회원 개개인의 보유·매매를 보지 않는다. 관리자 화면·API에는 회원 기록 조회 기능을 만들지 않고, 통계는 익명 집계(Task 8)로만 본다. **솔직한 한계도 문서에 적는다**: DB 최고 권한(Supabase 대시보드·service role)으로는 원본 `member_holdings`를 기술적으로 열 수 있다. 약속은 "화면·API가 보여주지 않고, 통계 표에는 연결고리가 없다"까지이며, 회원이 적을 때는 종목별 3건 미만을 숨기는 것으로 추측 가능성을 줄인다.
- [ ] **7-3b. 익명 통계 동의·고지**: 개인정보 처리방침과 첫 이용 안내에 "청산 기록은 회원과 연결되지 않는 익명 통계(종목, 매수가·매도가, 보유 기간)로 변환되어 서비스 개선·통계에 쓰이며, 이후 기록을 삭제하거나 탈퇴해도 익명 통계는 남는다"를 명시한다. 동의 방식(체크박스 vs 약관 포함)을 정한다.
- [ ] **7-3c. 뉴스·차트 표시 범위 확인**: 뉴스는 제목·출처·날짜·원문 링크만 보여주고 본문은 복사하지 않는다(저작권). 변호사 질의에 "종목별 뉴스 헤드라인 목록과 이동평균·52주 고저 대비 수치 표시"가 정보 제공 범위 안인지 함께 넣는다.
- [ ] **7-4. 교차 검증**: 테스트 회원 2명(허용·미허용)으로 Task 1의 RLS 테스트를 **배포 환경**에서 한 번 더 재현(허용 회원이 다른 회원 행을 못 보는지, 미허용 회원이 쓰기 못 하는지).
- [ ] **7-5. 단계 공개**: 허용 회원 1명 → 3일 관찰(오류·문의 확인) → 확대.

---

## Self-Review

- **요구 대비 커버리지:** 허용 회원 선택(Task 1·3) / My page 화면(Task 4·6) / 관리자 기능 이식 — 등록 여러 행·보유↔관찰↔청산·분할 매도·체크박스 삭제·평가손익·20일선 대비(Task 2·4·5) / 즉시 반영(브라우저 직접 쓰기, PC 폴링 없음) / 법률·개인정보 관문(Task 7). 청산 알림·신호는 제약으로 명시적 제외.
- **플레이스홀더 점검:** 구현 시 확인이 필요한 곳(`admin.html`의 기존 변수명, `market_cache` 열 이름, `_upsert` 시그니처, 예약 작업 체인)은 "무엇을 어디서 확인해 어떻게 맞추는지"를 단계에 적었다. 그 외 코드 단계는 실제 코드를 담았다.
- **타입·이름 일관성:** `member_sell(p_holding, p_qty, p_price, p_date)` ↔ `sell()`의 rpc 인자, `summarize(holding, sales, price, today)` ↔ 화면 호출, `build_rows` 출력 키 ↔ `member_prices` 컬럼명이 서로 일치한다.
- **알려진 미결:** 시세 지연 허용치(5일)는 설정값이며 필요 시 조정. 종목명 조회가 `member_prices`에 의존하므로 시세 공급(Task 5)이 먼저 한 번 돌아야 등록이 가능하다 — **권장 실행 순서: 1 → 2 → 5 → 8(SQL 적용·테스트까지) → 9A → 3 → 4 → 9B → 8(관리자 API·화면) → 6 → 7.** 9A의 `member_held_codes()`가 Task 8의 `db/003_member_anon_stats.sql`에 들어 있으므로, 9A를 실행하기 전에 Task 8의 Step 1~3(테스트 작성·SQL 적용·통과 확인)을 먼저 끝낸다.
