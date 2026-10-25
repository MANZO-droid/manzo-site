-- 회원 종목 리포트 P1~P2 (설계: docs/superpowers/specs/2026-10-25-member-report-addendum.md §3, §4, §7-2)
-- P1: 리포트 승인 스위치.  P2: 요청 접수 표·함수·하루 한도·한도 초과 기록.
-- 이 파일은 "추가만" 한다(기존 열·표·정책 변경 없음). 리포트 생성·메일 발송은 이후 단계(P3~P4).

-- ── P1. 리포트 승인 스위치 ──────────────────────────────────────────────
alter table public.member_feature_access
  add column if not exists reports_enabled boolean not null default false;

-- 기록장 허용(holdings_enabled)과 리포트 허용(reports_enabled)이 둘 다 true일 때만 true.
create or replace function public.member_has_report_access() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member_feature_access
                  where user_id = auth.uid() and holdings_enabled and reports_enabled);
$$;
revoke all on function public.member_has_report_access() from public, anon;
grant execute on function public.member_has_report_access() to authenticated;

-- ── P2. 요청 접수 표 ─────────────────────────────────────────────────────
-- 메일 주소는 저장하지 않는다(발송 시점에 서버가 회원 계정에서 읽는다).
create table if not exists public.member_report_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stock_code text not null check (stock_code ~ '^[0-9]{6}$'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'error')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text check (char_length(error_message) <= 200)
);
create index if not exists member_report_requests_user_idx on public.member_report_requests (user_id, requested_at desc);
create index if not exists member_report_requests_open_idx on public.member_report_requests (status, requested_at)
  where status in ('pending', 'processing');
alter table public.member_report_requests enable row level security;

-- 회원은 자기 행을 읽기만 한다. 쓰기는 member_request_report 함수(요청) 또는 서버(service role, 상태 갱신)만.
drop policy if exists "own report requests select" on public.member_report_requests;
create policy "own report requests select" on public.member_report_requests for select to authenticated
  using (user_id = auth.uid() and public.member_has_report_access());
revoke all on public.member_report_requests from anon, authenticated;
grant select on public.member_report_requests to authenticated;
grant all on public.member_report_requests to service_role;

-- 하루 한도(회원당 3건)를 넘겨 요청을 시도한 기록. 회장님께 보낼 알림의 근거이며, 회원은 읽지도 쓰지도 못한다.
-- alerted_attempts: 알림 메일에 이미 반영된 시도 횟수(알림 이후 늘어났는지 비교용).
create table if not exists public.member_report_limit_hits (
  user_id uuid not null references auth.users(id) on delete cascade,
  hit_date date not null,
  attempts int not null default 1,
  last_attempt_at timestamptz not null default now(),
  alerted_at timestamptz,
  alerted_attempts int not null default 0,
  primary key (user_id, hit_date)
);
alter table public.member_report_limit_hits enable row level security;
revoke all on public.member_report_limit_hits from anon, authenticated;
grant all on public.member_report_limit_hits to service_role;

-- 회원이 부르는 유일한 쓰기 통로. 모든 검사를 DB 안에서 한다.
-- 실패해도 예외를 내지 않고 { ok:false, reason } 를 돌려준다(예외로 끝내면 한도 초과 기록까지 취소되기 때문).
--   reason: no_access | bad_code | not_held | limit
-- 한도: KST 기준 하루 3건. pending/processing/sent 만 센다(error 는 세지 않음).
create or replace function public.member_request_report(p_stock_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Seoul')::date;
  lim constant int := 3;
  used int;
  dup record;
  new_id uuid;
begin
  if uid is null or not public.member_has_report_access() then
    return jsonb_build_object('ok', false, 'reason', 'no_access');
  end if;
  if p_stock_code is null or p_stock_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;
  -- 본인이 보유·관찰 중인 종목만 요청할 수 있다(청산 완료 종목·남의 종목·임의 종목 불가)
  if not exists (select 1 from public.member_holdings
                  where user_id = uid and stock_code = p_stock_code and status in ('open', 'watch')) then
    return jsonb_build_object('ok', false, 'reason', 'not_held');
  end if;

  -- 같은 회원의 동시 요청이 한도를 넘지 못하게 줄 세운다
  perform pg_advisory_xact_lock(hashtextextended('member_report:' || uid::text, 0));

  select count(*) into used from public.member_report_requests
   where user_id = uid and status in ('pending', 'processing', 'sent')
     and (requested_at at time zone 'Asia/Seoul')::date = today;

  -- 같은 종목이 이미 대기·처리 중이면 새로 만들지 않고 그 요청을 돌려준다(중복 클릭 방지)
  select id, status into dup from public.member_report_requests
   where user_id = uid and stock_code = p_stock_code and status in ('pending', 'processing')
   order by requested_at desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'id', dup.id, 'status', dup.status, 'duplicate', true,
                              'remaining', greatest(lim - used, 0));
  end if;

  if used >= lim then
    insert into public.member_report_limit_hits (user_id, hit_date)
    values (uid, today)
    on conflict (user_id, hit_date)
    do update set attempts = public.member_report_limit_hits.attempts + 1, last_attempt_at = now();
    return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', lim, 'remaining', 0);
  end if;

  insert into public.member_report_requests (user_id, stock_code)
  values (uid, p_stock_code) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'status', 'pending', 'duplicate', false,
                            'remaining', lim - used - 1);
end $$;
revoke all on function public.member_request_report(text) from public, anon;
grant execute on function public.member_request_report(text) to authenticated;
