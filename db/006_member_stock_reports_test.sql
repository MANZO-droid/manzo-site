-- 실행: 006_member_stock_reports.sql 적용 후(또는 같은 트랜잭션에서 먼저 실행한 뒤) 통째로 실행. 마지막에 롤백하므로 데이터가 남지 않는다.
begin;
  insert into public.member_stock_reports (stock_code, report_date, subject, body_html, body_text, used_ai)
  values ('005930', '2026-10-23', 't', '<p>x</p>', 'x', false);

  -- 같은 종목·같은 날은 한 건만(중복 생성 방지: 기본 키)
  do $$ begin
    begin
      insert into public.member_stock_reports (stock_code, report_date, subject, body_html, body_text)
      values ('005930', '2026-10-23', 't2', 'a', 'a');
      raise exception 'FAIL 1: 같은 종목·같은 날 두 건이 들어감';
    exception when unique_violation then null;
    end;
    -- 종목코드 형식 검사
    begin
      insert into public.member_stock_reports (stock_code, report_date, subject, body_html, body_text)
      values ('12345', '2026-10-23', 't', 'a', 'a');
      raise exception 'FAIL 2: 잘못된 종목코드가 들어감';
    exception when check_violation then null;
    end;
  end $$;

  -- 로그인한 회원: 읽기·쓰기 모두 불가
  insert into auth.users (id, instance_id, aud, role, email)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  do $$ begin
    begin
      perform 1 from public.member_stock_reports;
      raise exception 'FAIL 3: 회원이 리포트 표를 읽음';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.member_stock_reports (stock_code, report_date, subject, body_html, body_text)
      values ('000660', '2026-10-23', 't', 'a', 'a');
      raise exception 'FAIL 4: 회원이 리포트 표에 씀';
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- 비로그인(anon): 읽기 불가
  set local role anon;
  do $$ begin
    begin
      perform 1 from public.member_stock_reports;
      raise exception 'FAIL 5: anon 이 리포트 표를 읽음';
    exception when insufficient_privilege then null;
    end;
  end $$;
rollback;
