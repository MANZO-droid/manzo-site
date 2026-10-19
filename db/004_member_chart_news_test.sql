-- member_stock_detail 읽기 정책 테스트: 허용 회원은 "자기가 보유한 종목" 행만 읽는다. (ROLLBACK 구조 — DB에 남기지 않는다)
begin;
  insert into auth.users (id, instance_id, aud, role, email) values
   ('aaaaaaaa-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a4@test.invalid'),
   ('bbbbbbbb-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b4@test.invalid'),
   ('cccccccc-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c4@test.invalid'),
   ('dddddddd-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d4@test.invalid');
  -- A,B,C 는 허용, D 는 허용 안 됨
  insert into public.member_feature_access (user_id, holdings_enabled) values
   ('aaaaaaaa-0000-0000-0000-000000000011', true),
   ('bbbbbbbb-0000-0000-0000-000000000012', true),
   ('cccccccc-0000-0000-0000-000000000013', true),
   ('dddddddd-0000-0000-0000-000000000014', false);
  -- 보유: A=005930, B=000660, D=005930 (D 는 허용이 꺼져 있음), C 는 보유 없음 (postgres 권한으로 삽입)
  insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date) values
   ('aaaaaaaa-0000-0000-0000-000000000011','005930','삼성전자','open',70000,1,1,'2026-09-01'),
   ('bbbbbbbb-0000-0000-0000-000000000012','000660','SK하이닉스','open',100000,1,1,'2026-09-01'),
   ('dddddddd-0000-0000-0000-000000000014','005930','삼성전자','open',70000,1,1,'2026-09-01');
  insert into public.member_stock_detail (stock_code) values ('005930'), ('000660');

  -- A: 005930 만
  select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000011","role":"authenticated"}', true);
  set local role authenticated;
  do $$ begin
    if (select count(*) from public.member_stock_detail) <> 1
       or not exists (select 1 from public.member_stock_detail where stock_code = '005930') then
      raise exception 'FAIL: A 는 005930 한 행만 보여야 함 (count=%)', (select count(*) from public.member_stock_detail);
    end if;
    if exists (select 1 from public.member_stock_detail where stock_code = '000660') then
      raise exception 'FAIL: A 가 남의 종목 000660 을 봄'; end if;
  end $$;
  reset role;

  -- B: 000660 만
  select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000012","role":"authenticated"}', true);
  set local role authenticated;
  do $$ begin
    if (select count(*) from public.member_stock_detail) <> 1
       or not exists (select 1 from public.member_stock_detail where stock_code = '000660') then
      raise exception 'FAIL: B 는 000660 한 행만 보여야 함 (count=%)', (select count(*) from public.member_stock_detail);
    end if;
    if exists (select 1 from public.member_stock_detail where stock_code = '005930') then
      raise exception 'FAIL: B 가 남의 종목 005930 을 봄'; end if;
  end $$;
  reset role;

  -- C: 허용은 되었지만 보유 없음 → 0행
  select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000013","role":"authenticated"}', true);
  set local role authenticated;
  do $$ begin
    if (select count(*) from public.member_stock_detail) <> 0 then
      raise exception 'FAIL: 보유 없는 허용 회원 C 에게 행이 보임 (count=%)', (select count(*) from public.member_stock_detail); end if;
  end $$;
  reset role;

  -- D: 종목 보유 행은 있으나 허용 꺼짐 → 0행
  select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000014","role":"authenticated"}', true);
  set local role authenticated;
  do $$ begin
    if (select count(*) from public.member_stock_detail) <> 0 then
      raise exception 'FAIL: 미허용 회원 D 에게 행이 보임 (count=%)', (select count(*) from public.member_stock_detail); end if;
  end $$;
  reset role;

  -- anon 은 표 자체에 접근할 수 없다
  set local role anon;
  do $$ begin
    begin perform count(*) from public.member_stock_detail;
      raise exception 'FAIL: anon 이 member_stock_detail 을 읽음';
    exception when insufficient_privilege then null; end;
  end $$;
  reset role;

  -- 정책 정의 자체 확인(실수로 조건이 빠지는 것 방지)
  do $$ begin
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='member_stock_detail'
                    and policyname='detail read' and qual like '%member_holdings%') then
      raise exception 'FAIL: detail read 정책에 보유 조건이 없음'; end if;
  end $$;
rollback;
