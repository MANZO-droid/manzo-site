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
    -- 값 검증: 4주@75000 + 6주@80000 → 가중평균 매도가 78000, 수익률 (78000/70000-1)*100 ≈ 11.43%, 매도 2회, 보유 34일
    if (select count(*) from public.member_trade_stats where stock_code='005930' and exit_price=78000
          and round(return_pct,2)=11.43 and sell_count=2 and hold_days=34
          and entry_month='2026-09' and exit_month='2026-10') <> 3 then
      raise exception 'FAIL: 통계 값이 기대와 다름'; end if;
    -- 보유 집계: 3명 이상 보유 종목만 노출 (이 시점엔 005930 은 모두 청산, 035720 은 1명)
    if jsonb_array_length(public.member_open_aggregate(3)) <> 0 then
      raise exception 'FAIL: 보유 집계가 비어 있어야 함'; end if;
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
    begin perform public.member_open_aggregate(3);
      raise exception 'FAIL: 회원이 보유 집계 함수를 실행함';
    exception when insufficient_privilege then null; end;
    begin perform public.member_held_codes();
      raise exception 'FAIL: 회원이 코드 목록 함수를 실행함';
    exception when insufficient_privilege then null; end;
  end $$;
rollback;
