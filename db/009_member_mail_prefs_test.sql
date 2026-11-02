-- 실행: 009_member_mail_prefs.sql 을 적용한 뒤(또는 같은 트랜잭션 안에서 그 파일 내용을 먼저 실행한 뒤) 통째로 한 번에 실행.
-- 마지막에 롤백하므로 데이터가 남지 않는다. 어서션이 하나라도 실패하면 예외로 멈추고, 끝까지 오면 통과.
begin;
  insert into auth.users (id, instance_id, aud, role, email) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid'),
    ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid');

  -- ===== A로 로그인 =====
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  do $$
  declare r jsonb; n int; v numeric;
  begin
    -- 0) 처음에는 행이 없다(= 화면·발송기가 기본 3으로 본다)
    select count(*) into n from public.member_mail_prefs;
    if n <> 0 then raise exception 'FAIL 0: 행이 미리 있음'; end if;

    -- 1) 정상 값 저장: 5, 경계값 1·10, 0.5 단위 2.5
    r := public.member_set_alert_drop(5);
    if not (r->>'ok')::boolean or (r->>'pct')::numeric <> 5 then raise exception 'FAIL 1a: %', r; end if;
    select alert_drop_pct into v from public.member_mail_prefs where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if v <> 5 then raise exception 'FAIL 1b: 저장값 %', v; end if;
    r := public.member_set_alert_drop(1);
    if not (r->>'ok')::boolean then raise exception 'FAIL 1c(하한 1): %', r; end if;
    r := public.member_set_alert_drop(10);
    if not (r->>'ok')::boolean then raise exception 'FAIL 1d(상한 10): %', r; end if;
    r := public.member_set_alert_drop(2.5);
    if not (r->>'ok')::boolean then raise exception 'FAIL 1e(2.5): %', r; end if;
    select alert_drop_pct into v from public.member_mail_prefs where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if v <> 2.5 then raise exception 'FAIL 1f: 마지막 저장값 %', v; end if;
    select count(*) into n from public.member_mail_prefs;
    if n <> 1 then raise exception 'FAIL 1g: 같은 회원 행이 % 개(1개여야 함)', n; end if;

    -- 2) 범위 밖·0.5 단위가 아닌 값·null 은 거부하고 값을 바꾸지 않는다
    r := public.member_set_alert_drop(0.5);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2a: %', r; end if;
    r := public.member_set_alert_drop(10.5);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2b: %', r; end if;
    r := public.member_set_alert_drop(3.3);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2c: %', r; end if;
    r := public.member_set_alert_drop(-3);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2d: %', r; end if;
    r := public.member_set_alert_drop(null);
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 2e: %', r; end if;
    select alert_drop_pct into v from public.member_mail_prefs where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if v <> 2.5 then raise exception 'FAIL 2f: 거부된 호출이 값을 바꿈 %', v; end if;

    -- 3) 회원은 표에 직접 쓸 수 없다
    begin
      update public.member_mail_prefs set alert_drop_pct = 9;
      raise exception 'FAIL 3a: 회원이 표를 직접 수정함';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.member_mail_prefs (user_id, alert_drop_pct) values ('aaaaaaaa-0000-0000-0000-000000000001', 9);
      raise exception 'FAIL 3b: 회원이 표에 직접 넣음';
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- ===== B로 로그인: A의 행이 보이지 않고, 자기 설정은 A와 무관 =====
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  do $$
  declare r jsonb; n int; v numeric;
  begin
    select count(*) into n from public.member_mail_prefs;
    if n <> 0 then raise exception 'FAIL 4a: B가 남의 설정 행을 봄 (% 행)', n; end if;
    r := public.member_set_alert_drop(7);
    select count(*) into n from public.member_mail_prefs;
    if n <> 1 then raise exception 'FAIL 4b: B는 자기 행 1개만 보여야 함 (% 행)', n; end if;
    select alert_drop_pct into v from public.member_mail_prefs;
    if v <> 7 then raise exception 'FAIL 4c: B의 값 %', v; end if;
  end $$;

  -- ===== 비로그인(anon) =====
  set local role anon;
  do $$
  declare r jsonb;
  begin
    begin
      perform 1 from public.member_mail_prefs;
      raise exception 'FAIL 5a: anon 이 설정 표를 읽음';
    exception when insufficient_privilege then null;
    end;
    begin
      r := public.member_set_alert_drop(3);
      raise exception 'FAIL 5b: anon 이 설정 함수를 호출함 %', r;
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- ===== 서버(service role) 시점: A는 2.5, B는 7 =====
  reset role;
  do $$
  declare a numeric; b numeric;
  begin
    select alert_drop_pct into a from public.member_mail_prefs where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    select alert_drop_pct into b from public.member_mail_prefs where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
    if a <> 2.5 or b <> 7 then raise exception 'FAIL 6: A=% B=% (2.5 / 7 이어야 함)', a, b; end if;
  end $$;
rollback;
