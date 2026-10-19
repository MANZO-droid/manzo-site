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
