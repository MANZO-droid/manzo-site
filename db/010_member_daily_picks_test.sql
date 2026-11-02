-- 실행: 010_member_daily_picks.sql 을 적용한 뒤(또는 같은 트랜잭션 안에서 그 파일 내용을 먼저 실행한 뒤) 통째로 한 번에 실행.
-- 마지막에 롤백하므로 데이터가 남지 않는다. 어서션이 하나라도 실패하면 예외로 멈추고, 끝까지 오면 통과.
begin;
  insert into auth.users (id, instance_id, aud, role, email) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid');

  -- ===== 서버(service role) 시점: 정상 입력 =====
  insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price, open_price, prev_close, score, align_days, new_high, days_since_high, disp_pct, rsi, atr_pct, news, news_negative_count, chart_png)
  values ('2026-11-02', 1, '007660', '이수페타시스', 84200, 83000, 82000, 0.812, 25, true, 0, 6.5, 71, 0.032,
          '[{"title":"테스트 기사","link":"https://example.com/a"}]'::jsonb, 0, 'iVBORw0KGgo=');
  insert into public.member_daily_mail_log (user_id, send_date, status, holdings_count, sent_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-02', 'sent', 2, now());

  do $$
  declare n int;
  begin
    -- 1) 같은 날 같은 순위·같은 종목은 한 번만
    begin
      insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price) values ('2026-11-02', 1, '000660', 'x', 1);
      raise exception 'FAIL 1a: 같은 날 같은 순위가 두 번 들어감';
    exception when unique_violation then null;
    end;
    begin
      insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price) values ('2026-11-02', 2, '007660', 'x', 1);
      raise exception 'FAIL 1b: 같은 날 같은 종목이 두 번 들어감';
    exception when unique_violation then null;
    end;
    -- 2) 형식 검사: 종목코드, 순위, 가격, 기사 목록 형식·개수, 차트 크기
    begin
      insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price) values ('2026-11-02', 3, '12345', 'x', 1);
      raise exception 'FAIL 2a: 잘못된 종목코드가 들어감';
    exception when check_violation then null;
    end;
    begin
      insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price) values ('2026-11-02', 0, '000660', 'x', 1);
      raise exception 'FAIL 2b: 순위 0이 들어감';
    exception when check_violation then null;
    end;
    begin
      insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price) values ('2026-11-02', 3, '000660', 'x', 0);
      raise exception 'FAIL 2c: 가격 0이 들어감';
    exception when check_violation then null;
    end;
    begin
      insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price, news) values ('2026-11-02', 3, '000660', 'x', 1, '{"a":1}'::jsonb);
      raise exception 'FAIL 2d: 배열이 아닌 기사 목록이 들어감';
    exception when check_violation then null;
    end;
    begin
      insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price, news)
      values ('2026-11-02', 3, '000660', 'x', 1, (select jsonb_agg('{}'::jsonb) from generate_series(1, 21)));
      raise exception 'FAIL 2e: 기사 21건이 들어감';
    exception when check_violation then null;
    end;
    begin
      insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price, chart_png) values ('2026-11-02', 3, '000660', 'x', 1, repeat('a', 400001));
      raise exception 'FAIL 2f: 너무 큰 차트 이미지가 들어감';
    exception when check_violation then null;
    end;
    -- 3) 발송 기록: 같은 회원·같은 날 한 행, 상태값 검사
    begin
      insert into public.member_daily_mail_log (user_id, send_date, status) values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-02', 'sent');
      raise exception 'FAIL 3a: 같은 회원·같은 날 발송 기록이 두 번 들어감';
    exception when unique_violation then null;
    end;
    begin
      insert into public.member_daily_mail_log (user_id, send_date, status) values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-03', 'maybe');
      raise exception 'FAIL 3b: 잘못된 상태값이 들어감';
    exception when check_violation then null;
    end;
  end $$;

  -- ===== 로그인한 회원: 읽기·쓰기 모두 불가 =====
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  do $$ begin
    begin
      perform 1 from public.member_daily_picks;
      raise exception 'FAIL 4a: 회원이 일일 종목 표를 읽음';
    exception when insufficient_privilege then null;
    end;
    begin
      perform 1 from public.member_daily_mail_log;
      raise exception 'FAIL 4b: 회원이 발송 기록을 읽음';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.member_daily_picks (pick_date, rank, stock_code, stock_name, price) values ('2026-11-04', 1, '000660', 'x', 1);
      raise exception 'FAIL 4c: 회원이 일일 종목 표에 씀';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.member_daily_mail_log (user_id, send_date, status) values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-04', 'sent');
      raise exception 'FAIL 4d: 회원이 발송 기록에 씀';
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- ===== 비로그인(anon) =====
  set local role anon;
  do $$ begin
    begin
      perform 1 from public.member_daily_picks;
      raise exception 'FAIL 5a: anon 이 일일 종목 표를 읽음';
    exception when insufficient_privilege then null;
    end;
    begin
      perform 1 from public.member_daily_mail_log;
      raise exception 'FAIL 5b: anon 이 발송 기록을 읽음';
    exception when insufficient_privilege then null;
    end;
  end $$;

  -- ===== 회원 삭제(탈퇴) 시 그 회원의 발송 기록도 함께 삭제 =====
  reset role;
  delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  do $$
  declare n int;
  begin
    select count(*) into n from public.member_daily_mail_log where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    if n <> 0 then raise exception 'FAIL 6: 탈퇴한 회원의 발송 기록이 남음 (% 행)', n; end if;
  end $$;
rollback;
