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
    -- 통계 표 종목명은 회원 입력이 아니라 member_prices 의 이름이어야 한다: 회원이 이상한 이름을 넣고 청산해도 시세표 이름으로 기록된다
    insert into public.member_prices (stock_code, stock_name, trade_date) values ('000660', 'SK하이닉스', '2026-10-05')
      on conflict (stock_code) do update set stock_name = excluded.stock_name;
    insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '000660', '임의로지은이름', 'open', 100000, 1, 1, '2026-09-01') returning id into hid;
    perform public.member_sell(hid, null, 90000, '2026-10-06');
    if (select stock_name from public.member_trade_stats where stock_code='000660') is distinct from 'SK하이닉스' then
      raise exception 'FAIL: 통계 종목명이 회원 입력값을 따름: %', (select stock_name from public.member_trade_stats where stock_code='000660'); end if;

    -- 익명성: 통계 표의 열은 허용 목록과 정확히 일치해야 한다(허용 목록 방식)
    if array(select column_name::text from information_schema.columns
              where table_schema='public' and table_name='member_trade_stats' order by column_name::text collate "C")
       is distinct from array['entry_month','entry_price','exit_month','exit_price','hold_days','id','return_pct','sell_count','stock_code','stock_name'] then
      raise exception 'FAIL: 통계 표 열이 허용 목록과 다름';
    end if;

    s := public.member_stats_summary(3);
    if not exists (select 1 from jsonb_array_elements(s->'by_stock') e where e->>'stock_code'='005930') then
      raise exception 'FAIL: 3건 종목이 집계에서 빠짐'; end if;
    if exists (select 1 from jsonb_array_elements(s->'by_stock') e where e->>'stock_code'='000660') then
      raise exception 'FAIL: 1건 종목이 노출됨'; end if;
    -- 최소 표본 하한: NULL/0/-1 을 줘도 3 미만으로 내려갈 수 없다
    if (public.member_stats_summary(null)->>'min_n')::int <> 3
       or (public.member_stats_summary(0)->>'min_n')::int <> 3
       or (public.member_stats_summary(-1)->>'min_n')::int <> 3 then
      raise exception 'FAIL: min_n 하한이 3이 아님'; end if;
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

  select set_config('test.n_stats', (select count(*) from public.member_trade_stats)::text, true);

  -- 일반 로그인 회원은 통계 표·집계 함수에 접근할 수 없다
  set local role authenticated;
  do $$
  declare c text; hid uuid; hid_open uuid; n int; cols text[] := array[
    'avg_price = 1', 'remaining_qty = 1', 'stock_code = ''111111''', 'entry_date = ''2020-01-01''',
    'closed_on = ''2020-01-01''', 'initial_qty = 99', 'stock_name = ''x''', 'user_id = ''bbbbbbbb-0000-0000-0000-000000000002'''];
  begin
    select id into hid from public.member_holdings where stock_code='005930' and status='closed' limit 1;
    select id into hid_open from public.member_holdings where stock_code='035720' and status='open' limit 1;
    if hid is null or hid_open is null then raise exception 'FAIL: 테스트 준비 행 없음'; end if;
    -- (a) 허용되지 않은 열은 직접 UPDATE 할 수 없다
    foreach c in array cols loop
      begin
        execute format('update public.member_holdings set %s where id = %L', c, hid);
        raise exception 'FAIL: 직접 UPDATE 가 통과됨: %', c;
      exception when insufficient_privilege then null; end;
    end loop;
    -- (b) 청산된 행을 직접 되살릴 수 없다 (check 제약 위반)
    begin
      update public.member_holdings set status = 'open' where id = hid;
      raise exception 'FAIL: 청산 행을 open 으로 되돌림';
    exception when check_violation then null; end;
    begin
      update public.member_holdings set status = 'watch' where id = hid;
      raise exception 'FAIL: 청산 행을 watch 로 되돌림';
    exception when check_violation then null; end;
    -- 보유 중인 행을 직접 closed 로 바꿀 수도 없다 (member_sell 경유만 가능)
    begin
      update public.member_holdings set status = 'closed' where id = hid_open;
      raise exception 'FAIL: 보유 행을 직접 closed 로 바꿈';
    exception when check_violation then null; end;
    -- (d) 정상 UPDATE: open -> watch -> open, memo 수정은 성공
    update public.member_holdings set status = 'watch' where id = hid_open;
    get diagnostics n = row_count; if n <> 1 then raise exception 'FAIL: open->watch 실패'; end if;
    update public.member_holdings set status = 'open' where id = hid_open;
    get diagnostics n = row_count; if n <> 1 then raise exception 'FAIL: watch->open 실패'; end if;
    update public.member_holdings set memo = '메모' where id = hid_open;
    get diagnostics n = row_count; if n <> 1 then raise exception 'FAIL: memo 수정 실패'; end if;
    if (select memo from public.member_holdings where id = hid_open) is distinct from '메모' then
      raise exception 'FAIL: memo 반영 안 됨'; end if;
  end $$;
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

  reset role;
  do $$
  begin
    -- (c) 위조 시도 이후에도 통계 행 수는 그대로
    if (select count(*) from public.member_trade_stats) <> current_setting('test.n_stats')::int then
      raise exception 'FAIL: 위조 시도 후 통계 행 수가 변함'; end if;
  end $$;

  -- (g) service_role 은 집계 함수·코드 함수를 호출할 수 있다
  set local role service_role;
  do $$
  declare s jsonb; o jsonb; codes text[];
  begin
    s := public.member_stats_summary(3);
    o := public.member_open_aggregate(3);
    codes := public.member_held_codes();
    if jsonb_typeof(s) <> 'object' or not (s ? 'by_stock' and s ? 'overall' and s ? 'min_n') then
      raise exception 'FAIL: service_role 요약 형태 이상'; end if;
    if (s->>'total_trades')::int <> 4 then raise exception 'FAIL: service_role 요약 건수 %', s->>'total_trades'; end if;
    if not exists (select 1 from jsonb_array_elements(s->'by_stock') e where e->>'stock_code'='005930' and (e->>'n')::int = 3) then
      raise exception 'FAIL: service_role 종목 집계 이상'; end if;
    if jsonb_typeof(o) <> 'array' then raise exception 'FAIL: service_role 보유 집계 형태 이상'; end if;
    if array_position(codes, '035720') is null then raise exception 'FAIL: service_role 코드 목록 이상'; end if;
  end $$;
  reset role;
rollback;
