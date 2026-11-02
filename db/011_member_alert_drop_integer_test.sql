-- 실행: 009 와 011_member_alert_drop_integer.sql 을 적용한 뒤(또는 같은 트랜잭션 안에서 먼저 실행한 뒤) 통째로 한 번에 실행.
-- 마지막에 롤백하므로 데이터가 남지 않는다. 어서션이 하나라도 실패하면 예외로 멈추고, 끝까지 오면 통과.
begin;
  insert into auth.users (id, instance_id, aud, role, email) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid'),
    ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid');

  -- 표 자체도 정수 1~10 만 받는다(서버 시점)
  do $$ begin
    begin
      insert into public.member_mail_prefs (user_id, alert_drop_pct) values ('bbbbbbbb-0000-0000-0000-000000000002', 11);
      raise exception 'FAIL 0a: 11 이 표에 들어감';
    exception when check_violation then null;
    end;
    begin
      insert into public.member_mail_prefs (user_id, alert_drop_pct) values ('bbbbbbbb-0000-0000-0000-000000000002', 0);
      raise exception 'FAIL 0b: 0 이 표에 들어감';
    exception when check_violation then null;
    end;
    if (select data_type from information_schema.columns where table_name = 'member_mail_prefs' and column_name = 'alert_drop_pct') <> 'smallint' then
      raise exception 'FAIL 0c: 열 형식이 정수가 아님';
    end if;
  end $$;

  -- ===== A로 로그인 =====
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  do $$
  declare r jsonb; v int; n int;
  begin
    -- 1) 정수 저장: 5, 하한 1, 상한 10
    r := public.member_set_alert_drop(5);
    if not (r->>'ok')::boolean or (r->>'pct')::int <> 5 then raise exception 'FAIL 1a: %', r; end if;
    r := public.member_set_alert_drop(1);
    if not (r->>'ok')::boolean then raise exception 'FAIL 1b: %', r; end if;
    r := public.member_set_alert_drop(10);
    if not (r->>'ok')::boolean then raise exception 'FAIL 1c: %', r; end if;
    select alert_drop_pct into v from public.member_mail_prefs where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if v <> 10 then raise exception 'FAIL 1d: 저장값 %', v; end if;
    select count(*) into n from public.member_mail_prefs;
    if n <> 1 then raise exception 'FAIL 1e: 같은 회원 행이 % 개', n; end if;

    -- 2) 소수·범위 밖·null 은 거부하고 값을 바꾸지 않는다
    r := public.member_set_alert_drop(2.5);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2a: %', r; end if;
    r := public.member_set_alert_drop(5.5);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2b: %', r; end if;
    r := public.member_set_alert_drop(0);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2c: %', r; end if;
    r := public.member_set_alert_drop(11);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2d: %', r; end if;
    r := public.member_set_alert_drop(-3);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2e: %', r; end if;
    r := public.member_set_alert_drop(null);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2f: %', r; end if;
    select alert_drop_pct into v from public.member_mail_prefs where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if v <> 10 then raise exception 'FAIL 2g: 거부된 호출이 값을 바꿈 %', v; end if;

    -- 3) 회원은 표에 직접 쓸 수 없다
    begin
      update public.member_mail_prefs set alert_drop_pct = 9;
      raise exception 'FAIL 3a';
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- ===== B로 로그인: A의 행이 보이지 않는다 =====
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  do $$
  declare n int;
  begin
    select count(*) into n from public.member_mail_prefs;
    if n <> 0 then raise exception 'FAIL 4: B가 남의 설정 행을 봄 (% 행)', n; end if;
  end $$;

  -- ===== 비로그인(anon) =====
  set local role anon;
  do $$
  declare r jsonb;
  begin
    begin
      r := public.member_set_alert_drop(3);
      raise exception 'FAIL 5: anon 이 설정 함수를 호출함 %', r;
    exception when insufficient_privilege then null;
    end;
  end $$;
rollback;
