-- 회원 행동 기록 표 (회원 관리 페이지의 "체류시간/클릭" 집계용)
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 내용 붙여넣고 Run
-- (이 저장소 코드는 DDL을 자동 실행하지 않습니다 — 사람이 SQL Editor에서 직접 실행)
--
-- 로그인한 회원의 행동만 기록합니다(비로그인 방문자는 추적하지 않음).
-- event_type:
--   'page_view'  - 페이지 진입
--   'click'      - 링크/버튼 클릭 (label에 무엇을 눌렀는지)
--   'duration'   - 페이지를 떠날 때, 그동안 머문 시간(duration_ms)

create table if not exists public.user_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('page_view', 'click', 'duration')),
  page text,
  label text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists user_events_user_id_idx on public.user_events (user_id);
create index if not exists user_events_created_at_idx on public.user_events (created_at);

alter table public.user_events enable row level security;

-- 본인 이벤트만 본인이 쓸 수 있음 (브라우저는 anon key + 로그인 세션으로 insert)
drop policy if exists "insert own events" on public.user_events;
create policy "insert own events" on public.user_events
  for insert
  with check (auth.uid() = user_id);

-- select 정책을 두지 않음 — 회원 관리 API(api/admin-users.js)는 서버 전용
-- SUPABASE_SERVICE_ROLE_KEY로 조회하므로 RLS를 우회함. 즉 일반 회원은 이
-- 표를 브라우저에서 직접 읽을 수 없고(soft-delete/조회 정책 없음), 관리자
-- API를 통해서만 집계된 형태로 노출됨.
