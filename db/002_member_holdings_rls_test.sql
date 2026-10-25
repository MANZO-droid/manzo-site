-- 실행: Supabase SQL Editor 또는 MCP execute_sql로 통째로 한 번에. 마지막에 롤백하므로 데이터가 남지 않는다.
begin;
  -- 가짜 회원 2명 (A: 허용, B: 허용 표에 행은 있으나 holdings_enabled=false → 미허용)
  insert into auth.users (id, instance_id, aud, role, email)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid'),
         ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid');
  insert into public.member_feature_access (user_id, holdings_enabled)
  values ('aaaaaaaa-0000-0000-0000-000000000001', true),
         ('bbbbbbbb-0000-0000-0000-000000000002', false);
  -- B 소유 종목 하나(관리자 권한으로 미리 넣음): A가 남의 종목을 팔 수 없는지, B(미허용)가 팔 수 없는지 검사용
  insert into public.member_holdings (id, user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
  values ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', '000660', 'B종목', 'open', 100, 5, 5, '2026-10-01');

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
    -- 5) 이미 closed 된 종목은 다시 팔 수 없다(보유/관찰 중인 종목이 아니라는 오류 P0001)
    begin
      perform public.member_sell(h.id, 1, 1, '2026-10-07');
      raise exception 'FAIL: closed 종목 추가 매도가 통과됨';
    exception when raise_exception then
      if sqlerrm like 'FAIL:%' or sqlerrm not like '보유 또는 관찰 중인 종목이 아닙니다%' then
        raise exception 'FAIL: closed 재매도 오류가 기대와 다름: %', sqlerrm; end if;
    end;
    -- 6) A는 B의 종목을 팔 수 없다(내 것이 아니므로 "보유 또는 관찰 중인 종목이 아닙니다")
    begin
      perform public.member_sell('cccccccc-0000-0000-0000-000000000003', 1, 100, '2026-10-07');
      raise exception 'FAIL: A가 B의 종목을 매도함';
    exception when raise_exception then
      if sqlerrm like 'FAIL:%' or sqlerrm not like '보유 또는 관찰 중인 종목이 아닙니다%' then
        raise exception 'FAIL: 남의 종목 매도 오류가 기대와 다름: %', sqlerrm; end if;
    end;
    -- 7) 50행 상한: A는 이미 1행 → 49행 더 넣어 50행, 51번째는 check_violation
    insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
    select 'aaaaaaaa-0000-0000-0000-000000000001', '005930', 'cap'||g, 'open', 1, 1, 1, '2026-10-01'
      from generate_series(1, 49) g;
    select count(*) into n from public.member_holdings;
    if n <> 50 then raise exception 'FAIL: 상한 준비 행 수 % (50 기대)', n; end if;
    begin
      insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
      values ('aaaaaaaa-0000-0000-0000-000000000001', '005930', 'over', 'open', 1, 1, 1, '2026-10-01');
      raise exception 'FAIL: 51번째 등록이 통과됨';
    exception when check_violation then null;
    end;
  end $$;

  -- B(미허용)로 전환: A의 행이 안 보이고, 쓰기도 막혀야 한다
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  do $$
  declare n int;
  begin
    select count(*) into n from public.member_holdings;
    if n <> 0 then raise exception 'FAIL: 미허용 B가 행 % 개를 봄', n; end if;
    begin
      insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date)
      values ('bbbbbbbb-0000-0000-0000-000000000002', '005930', 'x', 'open', 1, 1, 1, '2026-10-01');
      raise exception 'FAIL: 미허용 회원 등록이 통과됨';
    exception when insufficient_privilege or check_violation then null;
    end;
    -- 미허용 B의 매도는 권한 오류
    begin
      perform public.member_sell('cccccccc-0000-0000-0000-000000000003', 1, 100, '2026-10-07');
      raise exception 'FAIL: 미허용 B의 매도가 통과됨';
    exception when insufficient_privilege then null;
    end;
    -- 허용 표를 스스로 바꿀 수 없다(B의 행은 false로 실제 존재함 → 0행 또는 권한 예외여야 함)
    begin
      update public.member_feature_access set holdings_enabled = true
       where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'FAIL: 미허용 회원이 허용 표를 수정함 (% 행)', n; end if;
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- 관리자 권한으로 돌아와 B의 허용 값이 정말 false로 남았는지 확인
  reset role;
  do $$
  begin
    if (select holdings_enabled from public.member_feature_access
         where user_id = 'bbbbbbbb-0000-0000-0000-000000000002') is distinct from false then
      raise exception 'FAIL: B의 holdings_enabled가 false가 아님(자가 승격됨)';
    end if;
  end $$;

  -- 비로그인(anon): 보유 표를 읽을 수 없다(권한 거부 또는 0행)
  set local role anon;
  do $$
  declare n int;
  begin
    begin
      select count(*) into n from public.member_holdings;
      if n <> 0 then raise exception 'FAIL: anon이 행 % 개를 봄', n; end if;
    exception when insufficient_privilege then null;
    end;
  end $$;
rollback;
-- 어서션이 하나라도 실패하면 위에서 예외로 멈춘다. 끝까지 오면 통과.
