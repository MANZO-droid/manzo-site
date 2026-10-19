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

-- 보안 보강(어드바이저 지적 반영): 비로그인(anon)은 두 함수를 호출할 수 없게 하고, 트리거 함수의 search_path를 고정한다.
revoke execute on function public.member_has_holdings_access() from anon;
revoke execute on function public.member_sell(uuid, numeric, numeric, date) from anon;
alter function public.member_holdings_cap() set search_path = public;
