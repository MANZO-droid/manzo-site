-- 회원 메일 수신 동의 (설계: docs/superpowers/specs/2026-11-02-member-mail-consent-design.md)
-- 현재 동의 상태 표 + 동의·철회 이력 표(덧붙이기 전용) + 회원이 부르는 유일한 쓰기 함수.
-- 이 파일은 "추가만" 한다(기존 표·정책 변경 없음). 이 단계가 끝나도 메일은 한 통도 나가지 않는다.

-- 현재 상태. 기본값은 "미동의". 회원은 자기 행을 읽기만 하고, 쓰기는 아래 함수로만 한다.
create table if not exists public.member_mail_consent (
  user_id uuid primary key references auth.users(id) on delete cascade,
  digest_consent boolean not null default false,
  text_version text not null,                 -- 동의·철회 당시 화면에 보여 준 문구 버전
  consented_at timestamptz,
  withdrawn_at timestamptz
);
alter table public.member_mail_consent enable row level security;
drop policy if exists "own consent select" on public.member_mail_consent;
create policy "own consent select" on public.member_mail_consent
  for select to authenticated using (user_id = auth.uid());
revoke all on public.member_mail_consent from anon, authenticated;
grant select on public.member_mail_consent to authenticated;
grant all on public.member_mail_consent to service_role;

-- 이력: 동의·철회가 바뀔 때마다 한 줄. 수정·삭제 경로를 만들지 않는다. 회원 접근 없음(서버만).
create table if not exists public.member_mail_consent_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('agree', 'withdraw')),
  text_version text not null,
  created_at timestamptz not null default now()
);
create index if not exists member_mail_consent_log_user_idx on public.member_mail_consent_log (user_id, created_at desc);
alter table public.member_mail_consent_log enable row level security;
revoke all on public.member_mail_consent_log from anon, authenticated;
grant all on public.member_mail_consent_log to service_role;

-- 회원이 부르는 유일한 쓰기 통로. 실패해도 예외를 내지 않고 { ok:false, reason } 를 돌려준다.
--   reason: not_logged_in | bad_input | stale_version
-- p_version 이 서버가 아는 현재 문구 버전(v_current)과 다르면 거부한다(낡은 화면의 옛 문구로 동의가 기록되는 것을 막음).
-- 값이 이미 같으면 이력을 늘리지 않는다(changed=false).
create or replace function public.member_set_mail_consent(p_agree boolean, p_version text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_current constant text := 'v1';
  prev boolean;
  now_ts timestamptz := now();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_logged_in');
  end if;
  if p_agree is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if p_version is distinct from v_current then
    return jsonb_build_object('ok', false, 'reason', 'stale_version');
  end if;

  -- 같은 회원의 동시 호출이 이력을 중복으로 쌓지 못하게 줄 세운다
  perform pg_advisory_xact_lock(hashtextextended('member_mail_consent:' || uid::text, 0));

  select digest_consent into prev from public.member_mail_consent where user_id = uid;

  if not found then
    -- 처음 호출. 해제 요청이면 바꿀 것이 없다(행도 이력도 만들지 않음).
    if not p_agree then
      return jsonb_build_object('ok', true, 'agreed', false, 'changed', false);
    end if;
    insert into public.member_mail_consent (user_id, digest_consent, text_version, consented_at)
    values (uid, true, v_current, now_ts);
  elsif prev = p_agree then
    return jsonb_build_object('ok', true, 'agreed', p_agree, 'changed', false);
  elsif p_agree then
    update public.member_mail_consent
       set digest_consent = true, text_version = v_current, consented_at = now_ts
     where user_id = uid;
  else
    update public.member_mail_consent
       set digest_consent = false, text_version = v_current, withdrawn_at = now_ts
     where user_id = uid;
  end if;

  insert into public.member_mail_consent_log (user_id, action, text_version)
  values (uid, case when p_agree then 'agree' else 'withdraw' end, v_current);
  return jsonb_build_object('ok', true, 'agreed', p_agree, 'changed', true, 'at', now_ts);
end;
$$;
revoke all on function public.member_set_mail_consent(boolean, text) from public, anon;
grant execute on function public.member_set_mail_consent(boolean, text) to authenticated;
