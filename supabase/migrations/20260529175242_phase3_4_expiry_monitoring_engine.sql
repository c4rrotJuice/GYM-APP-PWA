-- Phase 3.4 - Expiry monitoring engine, attendance eligibility, and notification trigger preparation.

begin;

create table if not exists public.membership_notification_triggers (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('membership_expiring_soon', 'membership_expired', 'membership_reactivated', 'membership_renewed')),
  trigger_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'prepared' check (status in ('prepared', 'queued', 'consumed', 'cancelled')),
  prepared_at timestamptz not null default now(),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (gym_id, trigger_key)
);

create index if not exists membership_notification_triggers_gym_status_idx
  on public.membership_notification_triggers (gym_id, status, prepared_at desc);
create index if not exists membership_notification_triggers_membership_idx
  on public.membership_notification_triggers (membership_id, trigger_type);
create index if not exists memberships_gym_status_dates_idx
  on public.memberships (gym_id, status, start_date, end_date);

alter table public.membership_notification_triggers enable row level security;

revoke all on table public.membership_notification_triggers from anon;
revoke all on table public.membership_notification_triggers from authenticated;
grant select on table public.membership_notification_triggers to authenticated;

drop policy if exists membership_notification_triggers_admin_select on public.membership_notification_triggers;
create policy membership_notification_triggers_admin_select
on public.membership_notification_triggers
for select
to authenticated
using (
  gym_id = app.current_gym_id()
  and app.user_is_admin()
);

create or replace function app.prepare_membership_notification_trigger(
  target_membership public.memberships,
  trigger_type_value text,
  payload_value jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  prepared_id uuid;
  payload jsonb;
  trigger_key_value text;
begin
  if target_membership.id is null then
    return false;
  end if;

  if trigger_type_value not in ('membership_expiring_soon', 'membership_expired', 'membership_reactivated', 'membership_renewed') then
    raise exception 'unsupported membership notification trigger type';
  end if;

  payload := coalesce(payload_value, '{}'::jsonb);
  trigger_key_value := concat_ws(
    ':',
    target_membership.id::text,
    trigger_type_value,
    coalesce(payload->>'as_of', target_membership.end_date::text)
  );

  insert into public.membership_notification_triggers (
    gym_id,
    user_id,
    membership_id,
    trigger_type,
    trigger_key,
    payload
  )
  values (
    target_membership.gym_id,
    target_membership.user_id,
    target_membership.id,
    trigger_type_value,
    trigger_key_value,
    payload
  )
  on conflict (gym_id, trigger_key) do nothing
  returning id into prepared_id;

  return prepared_id is not null;
end;
$$;

create or replace function app.recalculate_membership_statuses(
  target_gym_id uuid default app.current_gym_id(),
  as_of date default current_date,
  expiry_window_days integer default 7
)
returns table (
  expired_count integer,
  activated_count integer,
  pending_count integer,
  notification_triggers_prepared integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_record public.memberships%rowtype;
  updated_record public.memberships%rowtype;
  previous_status public.membership_status;
  next_status public.membership_status;
  prepared boolean;
begin
  if not app.user_is_admin() or target_gym_id is distinct from app.current_gym_id() then
    raise exception 'only active admins can recalculate gym membership status';
  end if;

  expired_count := 0;
  activated_count := 0;
  pending_count := 0;
  notification_triggers_prepared := 0;

  for membership_record in
    select *
    from public.memberships m
    where m.gym_id = target_gym_id
      and m.status in ('active', 'pending')
      and (
        m.end_date < as_of
        or m.start_date > as_of
        or (
          m.status = 'pending'
          and m.start_date <= as_of
          and m.end_date >= as_of
          and not exists (
            select 1
            from public.memberships active_m
            where active_m.id <> m.id
              and active_m.gym_id = m.gym_id
              and active_m.user_id = m.user_id
              and active_m.status = 'active'
              and active_m.start_date <= as_of
              and active_m.end_date >= as_of
          )
        )
      )
    order by m.end_date asc, m.created_at asc
    for update
  loop
    previous_status := membership_record.status;
    next_status := app.resolve_membership_status(
      membership_record.status,
      membership_record.start_date,
      membership_record.end_date,
      as_of
    );

    if next_status = 'active' and exists (
      select 1
      from public.memberships active_m
      where active_m.id <> membership_record.id
        and active_m.gym_id = membership_record.gym_id
        and active_m.user_id = membership_record.user_id
        and active_m.status = 'active'
        and active_m.start_date <= as_of
        and active_m.end_date >= as_of
    ) then
      next_status := 'pending';
    end if;

    if next_status is distinct from previous_status then
      update public.memberships
      set
        status = next_status,
        expired_at = case when next_status = 'expired' then coalesce(expired_at, now()) else expired_at end,
        resumed_at = case when next_status = 'active' then coalesce(resumed_at, now()) else resumed_at end,
        updated_at = now()
      where id = membership_record.id
      returning * into updated_record;

      if next_status = 'expired' then
        expired_count := expired_count + 1;
        prepared := app.prepare_membership_notification_trigger(
          updated_record,
          'membership_expired',
          jsonb_build_object('as_of', as_of, 'previous_status', previous_status)
        );

        if prepared then
          notification_triggers_prepared := notification_triggers_prepared + 1;
        end if;
      elsif next_status = 'active' then
        activated_count := activated_count + 1;
      elsif next_status = 'pending' then
        pending_count := pending_count + 1;
      end if;

      perform app.log_membership_history(
        updated_record,
        case when next_status = 'expired' then 'expired' else 'state_resolved' end,
        previous_status,
        jsonb_build_object('as_of', as_of, 'resolution', 'phase3_4_recalculation')
      );
    end if;
  end loop;

  for membership_record in
    select *
    from public.memberships m
    where m.gym_id = target_gym_id
      and m.status = 'active'
      and m.start_date <= as_of
      and m.end_date >= as_of
      and m.end_date <= as_of + greatest(expiry_window_days, 0)
    order by m.end_date asc, m.created_at asc
  loop
    prepared := app.prepare_membership_notification_trigger(
      membership_record,
      'membership_expiring_soon',
      jsonb_build_object('as_of', as_of, 'days_remaining', (membership_record.end_date - as_of)::integer)
    );

    if prepared then
      notification_triggers_prepared := notification_triggers_prepared + 1;
    end if;
  end loop;

  return next;
end;
$$;

create or replace function app.process_membership_expiry(
  target_gym_id uuid default app.current_gym_id(),
  as_of date default current_date,
  expiry_window_days integer default 7
)
returns table (
  expired_count integer,
  activated_count integer,
  pending_count integer,
  notification_triggers_prepared integer
)
language sql
security definer
set search_path = public
as $$
  select *
  from app.recalculate_membership_statuses(target_gym_id, as_of, expiry_window_days);
$$;

create or replace function app.membership_expiry_operational_summary(
  target_gym_id uuid default app.current_gym_id(),
  expiry_window_days integer default 7,
  as_of date default current_date
)
returns table (
  active_count bigint,
  expired_count bigint,
  suspended_count bigint,
  pending_count bigint,
  expiring_soon_count bigint,
  attendance_ready_count bigint,
  notification_triggers_prepared_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not app.user_is_admin() or target_gym_id is distinct from app.current_gym_id() then
    raise exception 'only active admins can view gym expiry operations';
  end if;

  perform app.recalculate_membership_statuses(target_gym_id, as_of, expiry_window_days);

  return query
  select
    count(*) filter (where m.status = 'active') as active_count,
    count(*) filter (where m.status = 'expired') as expired_count,
    count(*) filter (where m.status = 'suspended') as suspended_count,
    count(*) filter (where m.status = 'pending') as pending_count,
    count(*) filter (
      where m.status = 'active'
        and m.start_date <= as_of
        and m.end_date >= as_of
        and m.end_date <= as_of + greatest(expiry_window_days, 0)
    ) as expiring_soon_count,
    count(*) filter (
      where m.status = 'active'
        and m.start_date <= as_of
        and m.end_date >= as_of
    ) as attendance_ready_count,
    (
      select count(*)
      from public.membership_notification_triggers nt
      where nt.gym_id = target_gym_id
        and nt.status = 'prepared'
    ) as notification_triggers_prepared_count
  from public.memberships m
  where m.gym_id = target_gym_id;
end;
$$;

create or replace function app.can_attend_gym(
  target_user_id uuid,
  as_of date default current_date
)
returns table (
  can_attend boolean,
  membership_id uuid,
  membership_status public.membership_status,
  reason text,
  days_remaining integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_gym_id uuid;
  membership_record public.memberships%rowtype;
  resolved_status public.membership_status;
begin
  active_gym_id := app.current_gym_id();

  if active_gym_id is null or not (
    app.user_is_admin()
    or target_user_id = auth.uid()
    or app.trainer_has_member(target_user_id)
  ) then
    raise exception 'not allowed to evaluate attendance eligibility';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = target_user_id
      and u.gym_id = active_gym_id
      and u.account_status = 'active'
  ) then
    return query select false, null::uuid, null::public.membership_status, 'member_not_active'::text, null::integer;
    return;
  end if;

  select *
  into membership_record
  from public.memberships m
  where m.user_id = target_user_id
    and m.gym_id = active_gym_id
    and app.resolve_membership_status(m.status, m.start_date, m.end_date, as_of) = 'active'
  order by m.end_date desc, m.created_at desc
  limit 1;

  if found then
    return query select true, membership_record.id, 'active'::public.membership_status, 'active_membership'::text, (membership_record.end_date - as_of)::integer;
    return;
  end if;

  select *
  into membership_record
  from public.memberships m
  where m.user_id = target_user_id
    and m.gym_id = active_gym_id
  order by m.end_date desc, m.created_at desc
  limit 1;

  if not found then
    return query select false, null::uuid, null::public.membership_status, 'no_membership'::text, null::integer;
    return;
  end if;

  resolved_status := app.resolve_membership_status(
    membership_record.status,
    membership_record.start_date,
    membership_record.end_date,
    as_of
  );

  return query select
    false,
    membership_record.id,
    resolved_status,
    case
      when resolved_status = 'suspended' then 'membership_suspended'
      when resolved_status = 'expired' then 'membership_expired'
      when resolved_status = 'pending' then 'membership_not_started'
      when resolved_status = 'cancelled' then 'membership_cancelled'
      else 'membership_not_eligible'
    end,
    (membership_record.end_date - as_of)::integer;
end;
$$;

create or replace function app.user_has_active_membership(member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = member_id
      and m.gym_id = app.current_gym_id()
      and app.resolve_membership_status(m.status, m.start_date, m.end_date, current_date) = 'active'
  )
$$;

create or replace function app.qr_token_is_valid(qr_token_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_qr_tokens t
    where t.id = qr_token_id
      and t.gym_id = app.current_gym_id()
      and t.active = true
      and now() between t.issued_at and t.expires_at
  )
$$;

create or replace function app.can_log_attendance(member_id uuid, qr_token_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select member_id = auth.uid()
    and app.user_is_member()
    and exists (
      select 1
      from app.can_attend_gym(member_id, current_date) eligibility
      where eligibility.can_attend = true
    )
    and app.qr_token_is_valid(qr_token_id)
$$;

create or replace function public.process_membership_expiry(
  as_of date default current_date,
  expiry_window_days integer default 7
)
returns table (
  expired_count integer,
  activated_count integer,
  pending_count integer,
  notification_triggers_prepared integer
)
language sql
security invoker
set search_path = public, app
as $$
  select *
  from app.process_membership_expiry(app.current_gym_id(), as_of, expiry_window_days);
$$;

create or replace function public.membership_expiry_operational_summary(
  expiry_window_days integer default 7,
  as_of date default current_date
)
returns table (
  active_count bigint,
  expired_count bigint,
  suspended_count bigint,
  pending_count bigint,
  expiring_soon_count bigint,
  attendance_ready_count bigint,
  notification_triggers_prepared_count bigint
)
language sql
security invoker
set search_path = public, app
as $$
  select *
  from app.membership_expiry_operational_summary(app.current_gym_id(), expiry_window_days, as_of);
$$;

create or replace function public.can_attend_gym(
  target_user_id uuid default auth.uid(),
  as_of date default current_date
)
returns table (
  can_attend boolean,
  membership_id uuid,
  membership_status public.membership_status,
  reason text,
  days_remaining integer
)
language sql
security invoker
set search_path = public, app
as $$
  select *
  from app.can_attend_gym(target_user_id, as_of);
$$;

revoke execute on function app.prepare_membership_notification_trigger(public.memberships, text, jsonb) from public, authenticated;
grant execute on function app.recalculate_membership_statuses(uuid, date, integer) to authenticated;
grant execute on function app.process_membership_expiry(uuid, date, integer) to authenticated;
grant execute on function app.membership_expiry_operational_summary(uuid, integer, date) to authenticated;
grant execute on function app.can_attend_gym(uuid, date) to authenticated;
grant execute on function public.process_membership_expiry(date, integer) to authenticated;
grant execute on function public.membership_expiry_operational_summary(integer, date) to authenticated;
grant execute on function public.can_attend_gym(uuid, date) to authenticated;

commit;
