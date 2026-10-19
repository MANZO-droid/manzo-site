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
