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

-- member_prices 와 같은 권한 수준: anon 없음, authenticated 는 SELECT 만, service_role 전체
revoke all on public.member_stock_detail from anon, authenticated;
grant select on public.member_stock_detail to authenticated;
grant all on public.member_stock_detail to service_role;
