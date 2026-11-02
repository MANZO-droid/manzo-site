-- 회원 일일 메일 2-1단계 (설계: docs/superpowers/specs/2026-11-02-member-daily-mail-design.md §3, §4)
-- member_daily_picks : PC 가 매일 올리는 "스터디 종목" 사실 값(문장이 아니라 숫자·제목·링크). 회장님 보유·매수가·신호는 담지 않는다.
-- member_daily_mail_log : 회원·날짜별 발송 기록(하루 1통 보장). 종목코드·이메일은 저장하지 않는다.
-- 두 표 모두 서버(service role)만 읽고 쓴다. 회원·비로그인 접근 차단(RLS 켜고 정책 없음 + 권한 회수).
-- 이 파일은 "추가만" 한다(기존 표·정책 변경 없음). 이 단계가 끝나도 메일은 한 통도 나가지 않는다.

create table if not exists public.member_daily_picks (
  pick_date date not null,                              -- 기준 거래일
  rank int not null check (rank between 1 and 20),
  stock_code text not null check (stock_code ~ '^[0-9]{6}$'),
  stock_name text not null check (char_length(stock_name) between 1 and 40),
  price numeric not null check (price > 0),             -- 종가
  open_price numeric check (open_price > 0),            -- 당일 시가
  prev_close numeric check (prev_close > 0),            -- 전일 종가
  score numeric,                                        -- 차트 조건 점수
  align_days int check (align_days >= 0),               -- 5·20·60일선 정배열 지속 거래일
  new_high boolean not null default false,              -- 오늘 60일 신고가 여부
  days_since_high int check (days_since_high >= 0),     -- 마지막 60일 신고가 후 경과 거래일
  disp_pct numeric,                                     -- 20일선 대비 위치(%)
  rsi numeric check (rsi between 0 and 100),
  atr_pct numeric check (atr_pct >= 0),                 -- 일간 변동폭(%)
  news jsonb not null default '[]'::jsonb
    check (jsonb_typeof(news) = 'array' and jsonb_array_length(news) <= 20),   -- [{title, link}]
  news_negative_count int not null default 0 check (news_negative_count >= 0),
  chart_png text check (chart_png is null or char_length(chart_png) <= 400000),  -- 일봉 차트 base64(약 300KB 이하)
  created_at timestamptz not null default now(),
  primary key (pick_date, rank),
  unique (pick_date, stock_code)
);
alter table public.member_daily_picks enable row level security;
revoke all on public.member_daily_picks from anon, authenticated;
grant all on public.member_daily_picks to service_role;

create table if not exists public.member_daily_mail_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  send_date date not null,                              -- 발송일(KST)
  status text not null check (status in ('sent', 'error', 'skipped')),
  holdings_count int not null default 0 check (holdings_count >= 0),   -- 담은 보유 종목 수(개수만)
  sent_at timestamptz,
  error_message text check (char_length(error_message) <= 200),
  created_at timestamptz not null default now(),
  primary key (user_id, send_date)                      -- 같은 회원·같은 날 한 행 = 하루 1통 보장
);
alter table public.member_daily_mail_log enable row level security;
revoke all on public.member_daily_mail_log from anon, authenticated;
grant all on public.member_daily_mail_log to service_role;
