-- 알람선을 정수(1~10%)로만 받도록 바꾼다 (2026-11-02 회장님 요청: 선택지가 너무 많음).
-- 009 에서 만든 member_mail_prefs 를 고친다. 이미 저장된 값은 반올림해 정수로 바꾼다(예: 5.5 → 6).
-- 함수 member_set_alert_drop 의 이름·인자(numeric)는 그대로 두고 검사만 정수로 바꾼다(화면·기존 호출 호환).

alter table public.member_mail_prefs drop constraint if exists member_mail_prefs_alert_drop_pct_check;
update public.member_mail_prefs set alert_drop_pct = round(alert_drop_pct);
alter table public.member_mail_prefs alter column alert_drop_pct drop default;
alter table public.member_mail_prefs alter column alert_drop_pct type smallint using round(alert_drop_pct)::smallint;
alter table public.member_mail_prefs alter column alert_drop_pct set default 3;
alter table public.member_mail_prefs
  add constraint member_mail_prefs_alert_drop_pct_check check (alert_drop_pct between 1 and 10);

-- reason: not_logged_in | bad_input   (1 미만·10 초과·정수가 아닌 값·null 은 bad_input)
create or replace function public.member_set_alert_drop(p_pct numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_logged_in');
  end if;
  if p_pct is null or p_pct < 1 or p_pct > 10 or p_pct <> round(p_pct) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  insert into public.member_mail_prefs (user_id, alert_drop_pct, updated_at)
  values (uid, p_pct::smallint, now())
  on conflict (user_id) do update set alert_drop_pct = excluded.alert_drop_pct, updated_at = now();
  return jsonb_build_object('ok', true, 'pct', p_pct::int);
end;
$$;
revoke all on function public.member_set_alert_drop(numeric) from public, anon;
grant execute on function public.member_set_alert_drop(numeric) to authenticated;
