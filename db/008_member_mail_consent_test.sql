-- 실행: 008_member_mail_consent.sql 을 적용한 뒤(또는 같은 트랜잭션 안에서 그 파일 내용을 먼저 실행한 뒤) 통째로 한 번에 실행.
-- 마지막에 롤백하므로 데이터가 남지 않는다. 어서션이 하나라도 실패하면 예외로 멈추고, 끝까지 오면 통과.
begin;
  insert into auth.users (id, instance_id, aud, role, email) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid'),
    ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid');

  -- ===== A로 로그인 =====
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  do $$
  declare r jsonb; n int; agreed boolean;
  begin
    -- 0) 처음에는 행이 없다 = 미동의. 해제 요청은 아무것도 만들지 않는다.
    r := public.member_set_mail_consent(false, 'v1');
    if not (r->>'ok')::boolean or (r->>'changed')::boolean then raise exception 'FAIL 0a: %', r; end if;
    select count(*) into n from public.member_mail_consent;
    if n <> 0 then raise exception 'FAIL 0b: 해제 요청이 행을 만듦'; end if;

    -- 1) 동의 → 상태 true
    r := public.member_set_mail_consent(true, 'v1');
    if not (r->>'ok')::boolean or not (r->>'agreed')::boolean or not (r->>'changed')::boolean then raise exception 'FAIL 1a: %', r; end if;
    select digest_consent into agreed from public.member_mail_consent where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if agreed is distinct from true then raise exception 'FAIL 1b: 상태가 true 가 아님'; end if;

    -- 2) 같은 동의 반복 → 변화 없음
    r := public.member_set_mail_consent(true, 'v1');
    if (r->>'changed')::boolean then raise exception 'FAIL 2: 같은 동의가 변경으로 처리됨 %', r; end if;

    -- 3) 철회 → 상태 false
    r := public.member_set_mail_consent(false, 'v1');
    if not (r->>'ok')::boolean or (r->>'agreed')::boolean or not (r->>'changed')::boolean then raise exception 'FAIL 3a: %', r; end if;
    select digest_consent into agreed from public.member_mail_consent where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if agreed is distinct from false then raise exception 'FAIL 3b: 철회 후 상태가 false 가 아님'; end if;

    -- 4) 낡은 문구 버전·잘못된 입력은 거부(예외 없이 ok=false)
    r := public.member_set_mail_consent(true, 'v0');
    if (r->>'ok')::boolean or r->>'reason' <> 'stale_version' then raise exception 'FAIL 4a: %', r; end if;
    r := public.member_set_mail_consent(true, null);
    if (r->>'ok')::boolean or r->>'reason' <> 'stale_version' then raise exception 'FAIL 4b: %', r; end if;
    r := public.member_set_mail_consent(null, 'v1');
    if (r->>'ok')::boolean or r->>'reason' <> 'bad_input' then raise exception 'FAIL 4c: %', r; end if;
    select digest_consent into agreed from public.member_mail_consent where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if agreed is distinct from false then raise exception 'FAIL 4d: 거부된 호출이 상태를 바꿈'; end if;

    -- 5) 회원은 표에 직접 쓸 수 없고, 이력 표는 읽지도 못한다
    begin
      update public.member_mail_consent set digest_consent = true;
      raise exception 'FAIL 5a: 회원이 상태 표를 직접 수정함';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.member_mail_consent (user_id, digest_consent, text_version)
      values ('aaaaaaaa-0000-0000-0000-000000000001', true, 'v1');
      raise exception 'FAIL 5b: 회원이 상태 표에 직접 넣음';
    exception when insufficient_privilege then null;
    end;
    begin
      perform 1 from public.member_mail_consent_log;
      raise exception 'FAIL 5c: 회원이 이력 표를 읽음';
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- ===== B로 로그인: A의 행이 보이지 않고, 자기 동의는 A와 무관 =====
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  do $$
  declare r jsonb; n int;
  begin
    select count(*) into n from public.member_mail_consent;
    if n <> 0 then raise exception 'FAIL 6a: B가 남의 동의 행을 봄 (% 행)', n; end if;
    r := public.member_set_mail_consent(true, 'v1');
    select count(*) into n from public.member_mail_consent;
    if n <> 1 then raise exception 'FAIL 6b: B는 자기 행 1개만 보여야 함 (% 행)', n; end if;
  end $$;

  -- ===== 비로그인(anon) =====
  set local role anon;
  do $$
  declare r jsonb;
  begin
    begin
      perform 1 from public.member_mail_consent;
      raise exception 'FAIL 7a: anon 이 상태 표를 읽음';
    exception when insufficient_privilege then null;
    end;
    begin
      r := public.member_set_mail_consent(true, 'v1');
      raise exception 'FAIL 7b: anon 이 동의 함수를 호출함 %', r;
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- ===== 서버(service role) 시점에서 이력 확인 =====
  reset role;
  do $$
  declare n int; a int; w int;
  begin
    select count(*) into n from public.member_mail_consent_log where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    select count(*) filter (where action = 'agree'), count(*) filter (where action = 'withdraw') into a, w
      from public.member_mail_consent_log where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if n <> 2 or a <> 1 or w <> 1 then raise exception 'FAIL 8: A의 이력은 동의 1·철회 1 이어야 함 (전체 %, 동의 %, 철회 %)', n, a, w; end if;
    select count(*) into n from public.member_mail_consent_log where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
    if n <> 1 then raise exception 'FAIL 9: B의 이력은 1줄이어야 함 (%)', n; end if;
  end $$;
rollback;
