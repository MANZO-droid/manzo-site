-- 회원 종목 리포트 P3 (설계: docs/superpowers/specs/2026-10-25-member-report-addendum.md §5)
-- 종목·날짜별로 만든 리포트를 보관한다. 회원 정보가 전혀 없고(종목 단위 공개 정보), 같은 종목·같은 날 요청은 한 번만 생성해 재사용한다.
-- 서버(service role)만 읽고 쓴다. 회원 브라우저는 이 표에 접근하지 못한다(RLS 켜고 정책 없음 + 권한 회수).
-- 추가만 하는 변경이다(기존 표·정책 변경 없음).
create table if not exists public.member_stock_reports (
  stock_code text not null check (stock_code ~ '^[0-9]{6}$'),
  report_date date not null,                 -- 리포트가 기준으로 삼은 시세일(거래일)
  subject text not null check (char_length(subject) <= 200),
  body_html text not null,
  body_text text not null,
  used_ai boolean not null default false,    -- false = AI 설명 없이 수치·뉴스 제목만 담은 기본형
  generated_at timestamptz not null default now(),
  primary key (stock_code, report_date)
);
alter table public.member_stock_reports enable row level security;
revoke all on public.member_stock_reports from anon, authenticated;
grant all on public.member_stock_reports to service_role;
