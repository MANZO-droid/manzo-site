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
-- 허용 회원이라도 "자기가 보유한 종목" 행만 읽는다 (member_stock_detail_own_only 마이그레이션으로 좁힘).
-- 안쪽 member_holdings 조회도 RLS 가 본인 행만 보이게 한다.
create policy "detail read" on public.member_stock_detail for select to authenticated
  using (public.member_has_holdings_access()
         and exists (select 1 from public.member_holdings h
                      where h.user_id = auth.uid() and h.stock_code = member_stock_detail.stock_code));

-- member_prices 와 같은 권한 수준: anon 없음, authenticated 는 SELECT 만, service_role 전체
revoke all on public.member_stock_detail from anon, authenticated;
grant select on public.member_stock_detail to authenticated;
grant all on public.member_stock_detail to service_role;
