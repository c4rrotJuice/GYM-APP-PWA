-- Phase 3.2 - Membership assignment workflow, history, and state resolution.

begin;

create table if not exists public.membership_history (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null check (action in ('assigned', 'renewed', 'expired', 'suspended', 'reactivated', 'state_resolved')),
  old_status public.membership_status,
  new_status public.membership_status,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists membership_history_gym_user_created_idx
  on public.membership_history (gym_id, user_id, created_at desc);
create index if not exists membership_history_membership_created_idx
  on public.membership_history (membership_id, created_at desc);

alter table public.membership_history enable row level security;

revoke all on table public.membership_history from anon;
revoke all on table public.membership_history from authenticated;
grant select on table public.membership_history to authenticated;

drop policy if exists membership_history_select_scoped on public.membership_history;
create policy membership_history_select_scoped
on public.membership_history
for select
to authenticated
using (
  gym_id = app.current_gym_id()
  and (
    user_id = auth.uid()
    or app.user_is_admin()
    or app.trainer_has_member(user_id)
  )
);

create or replace function app.log_membership_history(
  target_membership public.memberships,
  action_name text,
  old_status_value public.membership_status default null,
  details_value jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.membership_history (
    gym_id,
    membership_id,
    user_id,
    action,
    old_status,
    new_status,
    details,
    created_by
  )
  values (
    target_membership.gym_id,
    target_membership.id,
    target_membership.user_id,
    action_name,
    old_status_value,
    target_membership.status,
    coalesce(details_value, '{}'::jsonb),
    auth.uid()
  );
end;
$$;

create or replace function app.prevent_membership_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.status = 'expired'
    and (
      to_jsonb(new) - 'updated_at'
    ) is distinct from (
      to_jsonb(old) - 'updated_at'
    ) then
    raise exception 'expired memberships are immutable historical records';
  end if;

  if new.status in ('active', 'pending') and exists (
    select 1
    from public.memberships existing
    where existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and existing.user_id = new.user_id
      and existing.gym_id = new.gym_id
      and existing.status in ('active', 'pending')
      and daterange(existing.start_date, existing.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'membership dates overlap an active or pending membership for this member';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_membership_overlap on public.memberships;
create trigger prevent_membership_overlap
before insert or update on public.memberships
for each row execute function app.prevent_membership_overlap();

create or replace function app.expire_memberships(
  target_gym_id uuid default app.current_gym_id(),
  as_of date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer := 0;
  changed_record public.memberships%rowtype;
begin
  if not app.user_is_admin() then
    raise exception 'only active admins can materialize membership expiry';
  end if;

  for changed_record in
    update public.memberships
    set
      status = 'expired',
      expired_at = coalesce(expired_at, now()),
      updated_at = now()
    where gym_id = target_gym_id
      and status in ('active', 'pending')
      and end_date < as_of
    returning *
  loop
    changed_count := changed_count + 1;
    perform app.log_membership_history(changed_record, 'expired', null, jsonb_build_object('as_of', as_of));
  end loop;

  return changed_count;
end;
$$;

create or replace function app.resolve_active_membership(
  target_user_id uuid,
  as_of date default current_date
)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  active_gym_id uuid;
  current_membership public.memberships%rowtype;
  previous_status public.membership_status;
begin
  active_gym_id := app.current_gym_id();

  if active_gym_id is null or not (
    app.user_is_admin()
    or target_user_id = auth.uid()
    or app.trainer_has_member(target_user_id)
  ) then
    raise exception 'not allowed to resolve this membership';
  end if;

  if app.user_is_admin() then
    perform app.expire_memberships(active_gym_id, as_of);
  end if;

  select *
  into current_membership
  from public.memberships m
  where m.user_id = target_user_id
    and m.gym_id = active_gym_id
    and m.status = 'active'
    and m.start_date <= as_of
    and m.end_date >= as_of
  order by m.end_date desc, m.created_at desc
  limit 1;

  if found then
    return current_membership;
  end if;

  select *
  into current_membership
  from public.memberships m
  where m.user_id = target_user_id
    and m.gym_id = active_gym_id
    and m.status = 'pending'
    and m.start_date <= as_of
    and m.end_date >= as_of
  order by m.start_date asc, m.created_at asc
  limit 1
  for update;

  if found and not app.user_is_admin() then
    return current_membership;
  end if;

  if found then
    previous_status := current_membership.status;

    update public.memberships
    set
      status = 'active',
      resumed_at = coalesce(resumed_at, now()),
      updated_at = now()
    where id = current_membership.id
    returning * into current_membership;

    perform app.log_membership_history(
      current_membership,
      'state_resolved',
      previous_status,
      jsonb_build_object('as_of', as_of, 'resolution', 'pending_activated')
    );

    return current_membership;
  end if;

  return null;
end;
$$;

create or replace function app.renew_membership_from_plan(
  target_user_id uuid,
  target_plan_id uuid,
  target_payment_id uuid default null,
  as_of date default current_date
)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  active_gym_id uuid;
  plan_record public.membership_plans%rowtype;
  current_membership public.memberships%rowtype;
  previous_membership public.memberships%rowtype;
  next_start date;
  next_end date;
  next_status public.membership_status;
  result public.memberships%rowtype;
begin
  active_gym_id := app.current_gym_id();

  if not app.user_is_admin() or active_gym_id is null then
    raise exception 'only active admins can assign membership plans';
  end if;

  select *
  into plan_record
  from public.membership_plans
  where id = target_plan_id
    and gym_id = active_gym_id
    and active = true;

  if not found then
    raise exception 'membership plan is not active in this gym';
  end if;

  if not app.user_belongs_to_gym(target_user_id, active_gym_id) then
    raise exception 'member must belong to the active gym';
  end if;

  if not app.payment_belongs_to_gym(target_payment_id, active_gym_id) then
    raise exception 'payment must belong to the active gym';
  end if;

  current_membership := app.resolve_active_membership(target_user_id, as_of);

  if current_membership.id is not null then
    previous_membership := current_membership;
    next_start := current_membership.end_date + 1;
    next_status := 'pending';
  else
    select *
    into previous_membership
    from public.memberships m
    where m.user_id = target_user_id
      and m.gym_id = active_gym_id
      and m.status in ('expired', 'cancelled', 'suspended')
    order by m.end_date desc, m.created_at desc
    limit 1;

    next_start := as_of;
    next_status := 'active';
  end if;

  next_end := app.calculate_membership_end_date(next_start, plan_record.duration_type, plan_record.duration_days);

  insert into public.memberships (
    gym_id,
    user_id,
    membership_plan_id,
    payment_id,
    type,
    start_date,
    end_date,
    status,
    renewal_count,
    renewed_from_membership_id,
    last_renewed_at
  )
  values (
    active_gym_id,
    target_user_id,
    plan_record.id,
    target_payment_id,
    plan_record.name,
    next_start,
    next_end,
    next_status,
    case when previous_membership.id is null then 0 else previous_membership.renewal_count + 1 end,
    previous_membership.id,
    now()
  )
  returning * into result;

  perform app.log_membership_history(
    result,
    case when previous_membership.id is null then 'assigned' else 'renewed' end,
    null,
    jsonb_build_object(
      'as_of', as_of,
      'plan_id', plan_record.id,
      'renewed_from_membership_id', previous_membership.id
    )
  );

  return result;
end;
$$;

create or replace function app.suspend_membership(
  target_membership_id uuid,
  reason text default null
)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  active_gym_id uuid;
  previous_status public.membership_status;
  result public.memberships%rowtype;
begin
  active_gym_id := app.current_gym_id();

  if not app.user_is_admin() or active_gym_id is null then
    raise exception 'only active admins can suspend memberships';
  end if;

  select status
  into previous_status
  from public.memberships
  where id = target_membership_id
    and gym_id = active_gym_id
  for update;

  if not found then
    raise exception 'membership not found in active gym';
  end if;

  if previous_status = 'expired' then
    raise exception 'expired memberships cannot be suspended';
  end if;

  update public.memberships
  set
    status = 'suspended',
    suspended_at = coalesce(suspended_at, now()),
    updated_at = now()
  where id = target_membership_id
  returning * into result;

  perform app.log_membership_history(
    result,
    'suspended',
    previous_status,
    jsonb_build_object('reason', nullif(trim(reason), ''))
  );

  return result;
end;
$$;

create or replace function app.reactivate_membership(
  target_membership_id uuid,
  as_of date default current_date
)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  active_gym_id uuid;
  result public.memberships%rowtype;
  next_status public.membership_status;
begin
  active_gym_id := app.current_gym_id();

  if not app.user_is_admin() or active_gym_id is null then
    raise exception 'only active admins can reactivate memberships';
  end if;

  select *
  into result
  from public.memberships
  where id = target_membership_id
    and gym_id = active_gym_id
    and status = 'suspended'
  for update;

  if not found then
    raise exception 'suspended membership not found in active gym';
  end if;

  if result.end_date < as_of then
    next_status := 'expired';
  elsif result.start_date > as_of then
    next_status := 'pending';
  else
    next_status := 'active';
  end if;

  update public.memberships
  set
    status = next_status,
    resumed_at = now(),
    expired_at = case when next_status = 'expired' then coalesce(expired_at, now()) else null end,
    updated_at = now()
  where id = target_membership_id
  returning * into result;

  perform app.log_membership_history(
    result,
    'reactivated',
    'suspended',
    jsonb_build_object('as_of', as_of)
  );

  return result;
end;
$$;

create or replace function app.memberships_expiring_soon(
  target_gym_id uuid default app.current_gym_id(),
  window_days integer default 7,
  as_of date default current_date
)
returns table (
  id uuid,
  gym_id uuid,
  user_id uuid,
  membership_plan_id uuid,
  type text,
  start_date date,
  end_date date,
  status public.membership_status,
  days_remaining integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.user_is_admin() or target_gym_id is distinct from app.current_gym_id() then
    raise exception 'only active admins can list gym membership expiries';
  end if;

  return query
  select
    m.id,
    m.gym_id,
    m.user_id,
    m.membership_plan_id,
    m.type,
    m.start_date,
    m.end_date,
    m.status,
    (m.end_date - as_of)::integer as days_remaining
  from public.memberships m
  where m.gym_id = target_gym_id
    and m.status = 'active'
    and m.end_date >= as_of
    and m.end_date <= as_of + greatest(window_days, 0)
  order by m.end_date asc, m.created_at asc;
end;
$$;

revoke execute on function app.log_membership_history(public.memberships, text, public.membership_status, jsonb) from public, authenticated;
revoke execute on function app.expire_memberships(uuid, date) from public, authenticated;
grant execute on function app.resolve_active_membership(uuid, date) to authenticated;
grant execute on function app.renew_membership_from_plan(uuid, uuid, uuid, date) to authenticated;
grant execute on function app.suspend_membership(uuid, text) to authenticated;
grant execute on function app.reactivate_membership(uuid, date) to authenticated;
grant execute on function app.memberships_expiring_soon(uuid, integer, date) to authenticated;

commit;
