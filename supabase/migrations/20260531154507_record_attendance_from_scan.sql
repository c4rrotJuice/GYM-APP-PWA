-- Server-side member attendance recording from a scanned QR token.

begin;

create or replace function public.record_attendance_from_scan(scan_token text)
returns table (
  success boolean,
  message text
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  authenticated_user_id uuid;
  member_profile public.users%rowtype;
  active_membership public.memberships%rowtype;
  token_record public.attendance_qr_tokens%rowtype;
  today date := current_date;
begin
  -- 1. user authenticated
  authenticated_user_id := auth.uid();

  if authenticated_user_id is null then
    return query select false, 'User must be authenticated.';
    return;
  end if;

  select *
  into member_profile
  from public.users u
  where u.id = authenticated_user_id;

  if not found then
    return query select false, 'User profile was not found.';
    return;
  end if;

  -- 2. role == member
  if member_profile.role is distinct from 'member'::public.app_role then
    return query select false, 'Only members can record attendance from a scan.';
    return;
  end if;

  -- 3. account active
  if member_profile.account_status is distinct from 'active' then
    return query select false, 'Member account is not active.';
    return;
  end if;

  -- 4. active membership exists
  select *
  into active_membership
  from public.memberships m
  where m.user_id = authenticated_user_id
    and m.gym_id = member_profile.gym_id
    and m.status = 'active'::public.membership_status
  order by m.end_date desc, m.created_at desc
  limit 1;

  if not found then
    return query select false, 'No active membership found.';
    return;
  end if;

  -- 5. membership not expired
  if active_membership.end_date < today then
    return query select false, 'Membership has expired.';
    return;
  end if;

  -- 6. token valid
  select *
  into token_record
  from public.attendance_qr_tokens t
  where t.token = trim(coalesce(scan_token, ''))
    and t.gym_id = member_profile.gym_id
  limit 1;

  if not found then
    return query select false, 'Attendance token is invalid.';
    return;
  end if;

  -- 7. token active
  if token_record.active is not true or token_record.revoked_at is not null then
    return query select false, 'Attendance token is not active.';
    return;
  end if;

  -- 8. token not expired
  if token_record.expires_at <= now() then
    return query select false, 'Attendance token has expired.';
    return;
  end if;

  -- 9. attendance not already recorded today
  if exists (
    select 1
    from public.attendance_logs l
    where l.gym_id = member_profile.gym_id
      and l.user_id = authenticated_user_id
      and l.attendance_date = today
  ) then
    return query select false, 'Attendance already recorded today.';
    return;
  end if;

  insert into public.attendance_logs (
    gym_id,
    user_id,
    qr_token_id,
    attendance_date,
    source
  )
  values (
    member_profile.gym_id,
    authenticated_user_id,
    token_record.id,
    today,
    'qr_scan'
  );

  return query select true, 'Attendance recorded.';
  return;
exception
  when unique_violation then
    return query select false, 'Attendance already recorded today.';
    return;
end;
$$;

revoke execute on function public.record_attendance_from_scan(text) from public, anon;
grant execute on function public.record_attendance_from_scan(text) to authenticated;

commit;
