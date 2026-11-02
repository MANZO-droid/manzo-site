-- 회원 알람선 설정 (설계: docs/superpowers/specs/2026-11-02-member-daily-mail-design.md §5-4)
-- 알람선 = 회원이 입력한 평균 매수가 대비 −x%. 기본 3, 회원이 1~10%(0.5% 단위)에서 조정한다.
-- 메일 수신 동의 표(member_mail_consent)와 분리한다: 동의의 근거와 개인 설정을 섞지 않기 위해서다.
-- 이 파일은 "추가만" 한다(기존 표·정책 변경 없음). 이 단계가 끝나도 메일은 한 통도 나가지 않는다.

create table if not exists public.member_mail_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  alert_drop_pct numeric(3, 1) not null default 3
    check (alert_drop_pct between 1 and 10 and alert_drop_pct * 2 = round(alert_drop_pct * 2)),
  updated_at timestamptz not null default now()
);
alter table public.member_mail_prefs enable row level security;
-- 회원은 자기 행을 읽기만 한다(행이 없으면 화면·발송기가 기본값 3으로 본다). 쓰기는 아래 함수로만.
drop policy if exists "own prefs select" on public.member_mail_prefs;
create policy "own prefs select" on public.member_mail_prefs
  for select to authenticated using (user_id = auth.uid());
revoke all on public.member_mail_prefs from anon, authenticated;
grant select on public.member_mail_prefs to authenticated;
grant all on public.member_mail_prefs to service_role;

-- 회원이 부르는 유일한 쓰기 통로. 실패해도 예외를 내지 않고 { ok:false, reason } 를 돌려준다.
--   reason: not_logged_in | bad_input   (1 미만·10 초과·0.5 단위가 아닌 값·null 은 bad_input)
create or replace function public.member_set_alert_drop(p_pct numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_logged_in');
  end if;
  if p_pct is null or p_pct < 1 or p_pct > 10 or p_pct * 2 <> round(p_pct * 2) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  insert into public.member_mail_prefs (user_id, alert_drop_pct, updated_at)
  values (uid, p_pct, now())
  on conflict (user_id) do update set alert_drop_pct = excluded.alert_drop_pct, updated_at = now();
  return jsonb_build_object('ok', true, 'pct', p_pct);
end;
$$;
revoke all on function public.member_set_alert_drop(numeric) from public, anon;
grant execute on function public.member_set_alert_drop(numeric) to authenticated;
