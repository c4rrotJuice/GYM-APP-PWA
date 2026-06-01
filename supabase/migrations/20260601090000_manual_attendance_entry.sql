-- Manual attendance entry for admins and trainers.
-- QR scan recording remains handled by record_attendance_from_scan(text).

begin;

alter table public.attendance_logs
  alter column qr_token_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_logs_source_allowed'
      and conrelid = 'public.attendance_logs'::regclass
  ) then
    alter table public.attendance_logs
      add constraint attendance_logs_source_allowed
      check (source in ('qr', 'qr_scan', 'admin_manual', 'trainer_manual'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_logs_qr_token_required_for_qr'
      and conrelid = 'public.attendance_logs'::regclass
  ) then
    alter table public.attendance_logs
      add constraint attendance_logs_qr_token_required_for_qr
      check (
        (source in ('qr', 'qr_scan') and qr_token_id is not null)
        or (source in ('admin_manual', 'trainer_manual') and qr_token_id is null)
      );
  end if;
end
$$;

create or replace function app.enforce_tenant_row_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.gym_id is distinct from old.gym_id then
    raise exception '% gym_id cannot be changed', tg_table_name;
  end if;

  if tg_table_name = 'membership_plans' then
    return new;
  elsif tg_table_name = 'memberships' then
    if not app.user_belongs_to_gym(new.user_id, new.gym_id) then
      raise exception 'memberships user_id must belong to the row gym';
    end if;

    if not app.membership_plan_belongs_to_gym(new.membership_plan_id, new.gym_id) then
      raise exception 'memberships membership_plan_id must belong to the row gym';
    end if;

    if not app.payment_belongs_to_gym(new.payment_id, new.gym_id) then
      raise exception 'memberships payment_id must belong to the row gym';
    end if;
  elsif tg_table_name in ('payments', 'progress_logs') then
    if not app.user_belongs_to_gym(new.user_id, new.gym_id) then
      raise exception '% user_id must belong to the row gym', tg_table_name;
    end if;
  elsif tg_table_name = 'attendance_qr_tokens' then
    if not app.user_belongs_to_gym(new.generated_by, new.gym_id) then
      raise exception 'attendance token generator must belong to the row gym';
    end if;
  elsif tg_table_name = 'attendance_logs' then
    if not app.user_belongs_to_gym(new.user_id, new.gym_id) then
      raise exception 'attendance log user_id must belong to the row gym';
    end if;

    if new.created_by is not null and not app.user_belongs_to_gym(new.created_by, new.gym_id) then
      raise exception 'attendance log created_by must belong to the row gym';
    end if;

    if new.qr_token_id is not null and not exists (
      select 1
      from public.attendance_qr_tokens t
      where t.id = new.qr_token_id
        and t.gym_id = new.gym_id
    ) then
      raise exception 'attendance log qr_token_id must belong to the row gym';
    end if;
  elsif tg_table_name = 'workout_programs' then
    if not app.user_belongs_to_gym(new.created_by, new.gym_id) then
      raise exception 'workout creator must belong to the row gym';
    end if;
  elsif tg_table_name = 'user_workouts' then
    if not app.user_belongs_to_gym(new.user_id, new.gym_id) then
      raise exception 'user_workouts user_id must belong to the row gym';
    end if;

    if not app.workout_belongs_to_gym(new.workout_id, new.gym_id) then
      raise exception 'user_workouts workout_id must belong to the row gym';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.record_manual_attendance(member_id uuid)
returns table (
  success boolean,
  message text,
  attendance_log_id uuid,
  attendance_date date,
  attended_at timestamptz,
  source text
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  actor_id uuid;
  actor_profile public.users%rowtype;
  member_profile public.users%rowtype;
  today date := current_date;
  recorded_log public.attendance_logs%rowtype;
  attendance_source text;
begin
  actor_id := auth.uid();

  if actor_id is null then
    return query select false, 'User must be authenticated.', null::uuid, null::date, null::timestamptz, null::text;
    return;
  end if;

  select *
  into actor_profile
  from public.users u
  where u.id = actor_id;

  if not found or actor_profile.account_status is distinct from 'active' then
    return query select false, 'Active staff profile is required.', null::uuid, null::date, null::timestamptz, null::text;
    return;
  end if;

  if actor_profile.role not in ('admin'::public.app_role, 'trainer'::public.app_role) then
    return query select false, 'Manual attendance is limited to admins and trainers.', null::uuid, null::date, null::timestamptz, null::text;
    return;
  end if;

  select *
  into member_profile
  from public.users u
  where u.id = member_id
    and u.gym_id = actor_profile.gym_id
    and u.role = 'member'::public.app_role;

  if not found then
    return query select false, 'Member profile was not found in this gym.', null::uuid, null::date, null::timestamptz, null::text;
    return;
  end if;

  if member_profile.account_status is distinct from 'active' then
    return query select false, 'Member account is not active.', null::uuid, null::date, null::timestamptz, null::text;
    return;
  end if;

  if actor_profile.role = 'trainer'::public.app_role and member_profile.assigned_trainer is distinct from actor_id then
    return query select false, 'Trainer can only log attendance for assigned members.', null::uuid, null::date, null::timestamptz, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.attendance_logs l
    where l.gym_id = actor_profile.gym_id
      and l.user_id = member_id
      and l.attendance_date = today
  ) then
    return query select false, 'Attendance already recorded today.', null::uuid, today, null::timestamptz, null::text;
    return;
  end if;

  attendance_source := case
    when actor_profile.role = 'admin'::public.app_role then 'admin_manual'
    else 'trainer_manual'
  end;

  insert into public.attendance_logs (
    gym_id,
    user_id,
    qr_token_id,
    attendance_date,
    attended_at,
    created_by,
    source
  )
  values (
    actor_profile.gym_id,
    member_id,
    null,
    today,
    now(),
    actor_id,
    attendance_source
  )
  returning *
  into recorded_log;

  return query select true, 'Attendance recorded.', recorded_log.id, recorded_log.attendance_date, recorded_log.attended_at, recorded_log.source;
  return;
exception
  when unique_violation then
    return query select false, 'Attendance already recorded today.', null::uuid, today, null::timestamptz, null::text;
    return;
end;
$$;

revoke execute on function public.record_manual_attendance(uuid) from public, anon;
grant execute on function public.record_manual_attendance(uuid) to authenticated;

drop policy if exists attendance_logs_trainer_insert_manual_assigned on public.attendance_logs;
create policy attendance_logs_trainer_insert_manual_assigned
on public.attendance_logs
for insert
to authenticated
with check (
  gym_id = app.current_gym_id()
  and app.user_is_trainer()
  and app.trainer_has_member(user_id)
  and created_by = auth.uid()
  and source = 'trainer_manual'
  and qr_token_id is null
);

comment on function public.record_manual_attendance(uuid) is
  'Records same-day manual attendance for admins or trainers. Trainers are restricted to assigned members.';

commit;
