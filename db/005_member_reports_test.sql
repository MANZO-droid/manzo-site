-- 실행: 005_member_reports.sql 을 적용한 뒤(또는 같은 트랜잭션 안에서 그 파일 내용을 먼저 실행한 뒤) 이 파일을 통째로 한 번에 실행.
-- 마지막에 롤백하므로 데이터가 남지 않는다. 어서션이 하나라도 실패하면 예외로 멈추고, 끝까지 오면 통과.
begin;
  -- 가짜 회원: A(기록장+리포트 허용) / B(기록장만) / C(허용 행 없음) / D(리포트만 true, 기록장 false) / E(어제 3건 사용 이력)
  insert into auth.users (id, instance_id, aud, role, email) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid'),
    ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid'),
    ('cccccccc-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.invalid'),
    ('dddddddd-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@test.invalid'),
    ('eeeeeeee-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e@test.invalid');
  insert into public.member_feature_access (user_id, holdings_enabled, reports_enabled) values
    ('aaaaaaaa-0000-0000-0000-000000000001', true, true),
    ('bbbbbbbb-0000-0000-0000-000000000002', true, false),
    ('dddddddd-0000-0000-0000-000000000004', false, true),
    ('eeeeeeee-0000-0000-0000-000000000005', true, true);
  -- 보유 기록: A는 5종목(그중 1개는 청산), B·C·D·E는 각 1종목 이상
  insert into public.member_holdings (user_id, stock_code, stock_name, status, avg_price, initial_qty, remaining_qty, entry_date, closed_on) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '005930', '삼성전자', 'open', 1, 1, 1, '2026-10-01', null),
    ('aaaaaaaa-0000-0000-0000-000000000001', '000660', 'SK하이닉스', 'watch', 1, 1, 1, '2026-10-01', null),
    ('aaaaaaaa-0000-0000-0000-000000000001', '035720', '카카오', 'open', 1, 1, 1, '2026-10-01', null),
    ('aaaaaaaa-0000-0000-0000-000000000001', '051910', 'LG화학', 'open', 1, 1, 1, '2026-10-01', null),
    ('aaaaaaaa-0000-0000-0000-000000000001', '068270', '셀트리온', 'closed', 1, 1, 0, '2026-10-01', '2026-10-02'),
    ('bbbbbbbb-0000-0000-0000-000000000002', '005930', '삼성전자', 'open', 1, 1, 1, '2026-10-01', null),
    ('cccccccc-0000-0000-0000-000000000003', '005930', '삼성전자', 'open', 1, 1, 1, '2026-10-01', null),
    ('dddddddd-0000-0000-0000-000000000004', '005930', '삼성전자', 'open', 1, 1, 1, '2026-10-01', null),
    ('eeeeeeee-0000-0000-0000-000000000005', '005930', '삼성전자', 'open', 1, 1, 1, '2026-10-01', null),
    ('eeeeeeee-0000-0000-0000-000000000005', '000660', 'SK하이닉스', 'open', 1, 1, 1, '2026-10-01', null),
    ('eeeeeeee-0000-0000-0000-000000000005', '035720', '카카오', 'open', 1, 1, 1, '2026-10-01', null),
    ('eeeeeeee-0000-0000-0000-000000000005', '051910', 'LG화학', 'open', 1, 1, 1, '2026-10-01', null);
  -- 남의 요청(B)과 E의 어제 이력 3건을 관리자 권한으로 미리 넣는다
  insert into public.member_report_requests (user_id, stock_code, status, requested_at) values
    ('bbbbbbbb-0000-0000-0000-000000000002', '005930', 'sent', now()),
    ('eeeeeeee-0000-0000-0000-000000000005', '005930', 'sent', now() - interval '1 day'),
    ('eeeeeeee-0000-0000-0000-000000000005', '000660', 'sent', now() - interval '1 day'),
    ('eeeeeeee-0000-0000-0000-000000000005', '035720', 'sent', now() - interval '1 day');

  -- ===== A로 로그인한 상태 =====
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  do $$
  declare r jsonb; n int;
  begin
    -- 1) 첫 요청: 접수, 남은 횟수 2
    r := public.member_request_report('005930');
    if not (r->>'ok')::boolean or r->>'status' <> 'pending' or (r->>'remaining')::int <> 2 then
      raise exception 'FAIL 1: 첫 요청 결과 %', r; end if;
    -- 2) 같은 종목 중복 클릭: 새 행을 만들지 않고 기존 요청을 돌려줌
    r := public.member_request_report('005930');
    if not (r->>'ok')::boolean or not (r->>'duplicate')::boolean then raise exception 'FAIL 2: 중복 처리 %', r; end if;
    select count(*) into n from public.member_report_requests where stock_code = '005930';
    if n <> 1 then raise exception 'FAIL 2: A의 005930 요청 행 % 개(1개여야 함)', n; end if;
    -- 3) 관찰(watch) 종목도 요청 가능, 남은 횟수 1 → 0
    r := public.member_request_report('000660');
    if not (r->>'ok')::boolean or (r->>'remaining')::int <> 1 then raise exception 'FAIL 3a: %', r; end if;
    r := public.member_request_report('035720');
    if not (r->>'ok')::boolean or (r->>'remaining')::int <> 0 then raise exception 'FAIL 3b: %', r; end if;
    -- 4) 4번째 새 요청은 한도 초과(예외 없이 limit)
    r := public.member_request_report('051910');
    if (r->>'ok')::boolean or r->>'reason' <> 'limit' then raise exception 'FAIL 4: 한도 초과 결과 %', r; end if;
    select count(*) into n from public.member_report_requests where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if n <> 3 then raise exception 'FAIL 4: 한도 초과인데 요청 행이 % 개', n; end if;
    -- 5) 보유하지 않은 종목 / 청산 완료 종목 / 잘못된 코드
    r := public.member_request_report('373220');
    if r->>'reason' <> 'not_held' then raise exception 'FAIL 5a: %', r; end if;
    r := public.member_request_report('068270');
    if r->>'reason' <> 'not_held' then raise exception 'FAIL 5b(청산 종목): %', r; end if;
    r := public.member_request_report('12345');
    if r->>'reason' <> 'bad_code' then raise exception 'FAIL 5c: %', r; end if;
    r := public.member_request_report(null);
    if r->>'reason' <> 'bad_code' then raise exception 'FAIL 5d: %', r; end if;
    -- 6) A는 자기 요청 3건만 보인다(B의 요청은 안 보임)
    select count(*) into n from public.member_report_requests;
    if n <> 3 then raise exception 'FAIL 6: A에게 요청 % 건이 보임(3건이어야 함)', n; end if;
    -- 7) 표에 직접 쓸 수 없다
    begin
      insert into public.member_report_requests (user_id, stock_code) values ('aaaaaaaa-0000-0000-0000-000000000001', '051910');
      raise exception 'FAIL 7a: 직접 INSERT 가 통과됨';
    exception when insufficient_privilege then null;
    end;
    begin
      update public.member_report_requests set status = 'sent';
      raise exception 'FAIL 7b: 직접 UPDATE 가 통과됨';
    exception when insufficient_privilege then null;
    end;
    begin
      delete from public.member_report_requests;
      raise exception 'FAIL 7c: 직접 DELETE 가 통과됨';
    exception when insufficient_privilege then null;
    end;
    -- 8) 한도 초과 기록 표·승인 표는 회원이 읽거나 바꿀 수 없다
    begin
      perform 1 from public.member_report_limit_hits;
      raise exception 'FAIL 8a: 한도 기록을 읽을 수 있음';
    exception when insufficient_privilege then null;
    end;
    begin
      update public.member_feature_access set reports_enabled = true;
      raise exception 'FAIL 8b: 승인 표를 바꿀 수 있음';
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- ===== 관리자 권한으로 한도 기록 확인(알림 근거) =====
  reset role;
  do $$
  declare a int;
  begin
    select attempts into a from public.member_report_limit_hits
     where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and hit_date = (now() at time zone 'Asia/Seoul')::date;
    if a is distinct from 1 then raise exception 'FAIL 9a: 한도 초과 시도 기록 attempts=%', a; end if;
  end $$;

  -- A가 한 번 더 초과 시도 → 횟수 2
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  do $$ declare r jsonb; begin r := public.member_request_report('051910'); if r->>'reason' <> 'limit' then raise exception 'FAIL 9b: %', r; end if; end $$;
  reset role;
  do $$
  declare a int;
  begin
    select attempts into a from public.member_report_limit_hits where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if a <> 2 then raise exception 'FAIL 9c: 두 번째 초과 시도 attempts=%', a; end if;
    -- 10) 처리 실패(error)는 한도에 세지 않는다: 요청 하나를 error 로 바꾸면 다시 요청할 수 있다
    update public.member_report_requests set status = 'error', error_message = 'test'
     where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and stock_code = '035720';
  end $$;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  do $$ declare r jsonb; begin
    r := public.member_request_report('051910');
    if not (r->>'ok')::boolean then raise exception 'FAIL 10: error 건이 한도에 잡힘 %', r; end if;
  end $$;

  -- ===== B(기록장만 허용): 리포트 요청 불가, 자기 요청 조회도 불가 =====
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  do $$ declare r jsonb; n int; begin
    r := public.member_request_report('005930');
    if r->>'reason' <> 'no_access' then raise exception 'FAIL 11a: B %', r; end if;
    select count(*) into n from public.member_report_requests;
    if n <> 0 then raise exception 'FAIL 11b: 리포트 미허용 B가 요청 % 건을 봄', n; end if;
  end $$;
  -- ===== C(허용 행 없음), D(리포트만 true·기록장 false): 모두 불가 =====
  set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';
  do $$ declare r jsonb; begin
    r := public.member_request_report('005930');
    if r->>'reason' <> 'no_access' then raise exception 'FAIL 12a: C %', r; end if; end $$;
  set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';
  do $$ declare r jsonb; begin
    r := public.member_request_report('005930');
    if r->>'reason' <> 'no_access' then raise exception 'FAIL 12b: 기록장 미허용 D가 리포트 요청 가능 %', r; end if; end $$;

  -- ===== E: 어제 3건을 썼어도 오늘은 새로 시작(KST 날짜 기준) =====
  set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';
  do $$ declare r jsonb; begin
    r := public.member_request_report('051910');
    if not (r->>'ok')::boolean or (r->>'remaining')::int <> 2 then raise exception 'FAIL 13: 어제 이력이 오늘 한도에 잡힘 %', r; end if;
  end $$;

  -- ===== 비로그인(anon): 함수 호출 불가 =====
  set local role anon;
  do $$ begin
    begin
      perform public.member_request_report('005930');
      raise exception 'FAIL 14: anon 이 함수를 호출함';
    exception when insufficient_privilege then null;
    end;
  end $$;
rollback;
