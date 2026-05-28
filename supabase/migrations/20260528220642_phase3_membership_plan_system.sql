-- Phase 3.1 - Membership plan system.

begin;

create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  description text,
  duration_type text not null check (duration_type in ('weekly', 'monthly', 'custom')),
  duration_days integer not null check (duration_days > 0),
  price numeric(12, 2) not null default 0 check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, name)
);

alter table public.memberships add column if not exists membership_plan_id uuid references public.membership_plans(id) on delete restrict;
alter table public.memberships add column if not exists payment_id uuid references public.payments(id) on delete set null;
alter table public.memberships add column if not exists renewal_count integer not null default 0 check (renewal_count >= 0);
alter table public.memberships add column if not exists renewed_from_membership_id uuid references public.memberships(id) on delete set null;
alter table public.memberships add column if not exists suspended_at timestamptz;
alter table public.memberships add column if not exists resumed_at timestamptz;
alter table public.memberships add column if not exists cancelled_at timestamptz;
alter table public.memberships add column if not exists expired_at timestamptz;
alter table public.memberships add column if not exists last_renewed_at timestamptz;

create index if not exists membership_plans_gym_id_idx on public.membership_plans (gym_id);
create index if not exists membership_plans_gym_active_idx on public.membership_plans (gym_id, active);
create index if not exists memberships_plan_id_idx on public.memberships (membership_plan_id);
create index if not exists memberships_payment_id_idx on public.memberships (payment_id);
create index if not exists memberships_gym_user_status_end_idx on public.memberships (gym_id, user_id, status, end_date desc);

drop trigger if exists set_membership_plans_updated_at on public.membership_plans;
create trigger set_membership_plans_updated_at
before update on public.membership_plans
for each row execute function public.set_updated_at();

create or replace function app.membership_plan_belongs_to_gym(plan_id uuid, target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select plan_id is null or exists (
    select 1
    from public.membership_plans mp
    where mp.id = plan_id
      and mp.gym_id = target_gym_id
  )
$$;

create or replace function app.payment_belongs_to_gym(payment_id uuid, target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select payment_id is null or exists (
    select 1
    from public.payments p
    where p.id = payment_id
      and p.gym_id = target_gym_id
  )
$$;

create or replace function app.calculate_membership_end_date(
  start_on date,
  duration_type text,
  duration_days integer
)
returns date
language plpgsql
immutable
as $$
begin
  if start_on is null then
    raise exception 'membership start date is required';
  end if;

  if duration_type not in ('weekly', 'monthly', 'custom') then
    raise exception 'unsupported membership duration type';
  end if;

  if duration_days is null or duration_days <= 0 then
    raise exception 'membership duration_days must be positive';
  end if;

  return start_on + duration_days;
end;
$$;

create or replace function app.resolve_membership_status(
  stored_status public.membership_status,
  start_on date,
  end_on date,
  as_of date default current_date
)
returns public.membership_status
language sql
stable
as $$
  select case
    when stored_status in ('cancelled', 'suspended', 'pending') then stored_status
    when end_on < as_of then 'expired'::public.membership_status
    when start_on > as_of then 'pending'::public.membership_status
    else 'active'::public.membership_status
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

    if not exists (
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

drop trigger if exists enforce_membership_plans_tenant_integrity on public.membership_plans;
create trigger enforce_membership_plans_tenant_integrity
before insert or update on public.membership_plans
for each row execute function app.enforce_tenant_row_integrity();

drop trigger if exists enforce_memberships_tenant_integrity on public.memberships;
create trigger enforce_memberships_tenant_integrity
before insert or update on public.memberships
for each row execute function app.enforce_tenant_row_integrity();

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
  next_start date;
  next_end date;
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

  update public.memberships
  set
    status = 'expired',
    expired_at = coalesce(expired_at, now()),
    updated_at = now()
  where user_id = target_user_id
    and gym_id = active_gym_id
    and status = 'active'
    and end_date < as_of;

  select *
  into current_membership
  from public.memberships m
  where m.user_id = target_user_id
    and m.gym_id = active_gym_id
    and m.status = 'active'
    and m.end_date >= as_of
  order by m.end_date desc, m.created_at desc
  limit 1
  for update;

  if found then
    next_start := current_membership.end_date + 1;
    next_end := app.calculate_membership_end_date(next_start, plan_record.duration_type, plan_record.duration_days);

    update public.memberships
    set
      membership_plan_id = plan_record.id,
      payment_id = coalesce(target_payment_id, payment_id),
      end_date = next_end,
      status = 'active',
      renewal_count = renewal_count + 1,
      last_renewed_at = now(),
      expired_at = null,
      updated_at = now()
    where id = current_membership.id
    returning * into result;
  else
    next_start := as_of;
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
      'active',
      0,
      now()
    )
    returning * into result;
  end if;

  return result;
end;
$$;

alter table public.membership_plans enable row level security;

revoke all on table public.membership_plans from anon;
grant select, insert, update, delete on table public.membership_plans to authenticated;

drop policy if exists membership_plans_select_scoped on public.membership_plans;
create policy membership_plans_select_scoped
on public.membership_plans
for select
to authenticated
using (
  gym_id = app.current_gym_id()
  and (active = true or app.user_is_admin())
);

drop policy if exists membership_plans_admin_insert on public.membership_plans;
create policy membership_plans_admin_insert
on public.membership_plans
for insert
to authenticated
with check (app.user_is_admin() and gym_id = app.current_gym_id());

drop policy if exists membership_plans_admin_update on public.membership_plans;
create policy membership_plans_admin_update
on public.membership_plans
for update
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id())
with check (app.user_is_admin() and gym_id = app.current_gym_id());

drop policy if exists membership_plans_admin_delete on public.membership_plans;
create policy membership_plans_admin_delete
on public.membership_plans
for delete
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id());

drop policy if exists memberships_select_scoped on public.memberships;
create policy memberships_select_scoped
on public.memberships
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

drop policy if exists memberships_admin_insert on public.memberships;
create policy memberships_admin_insert
on public.memberships
for insert
to authenticated
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and app.user_belongs_to_gym(user_id, gym_id)
  and app.membership_plan_belongs_to_gym(membership_plan_id, gym_id)
  and app.payment_belongs_to_gym(payment_id, gym_id)
);

drop policy if exists memberships_admin_update on public.memberships;
create policy memberships_admin_update
on public.memberships
for update
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id())
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and app.user_belongs_to_gym(user_id, gym_id)
  and app.membership_plan_belongs_to_gym(membership_plan_id, gym_id)
  and app.payment_belongs_to_gym(payment_id, gym_id)
);

drop policy if exists memberships_admin_delete on public.memberships;
create policy memberships_admin_delete
on public.memberships
for delete
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id());

grant execute on function app.calculate_membership_end_date(date, text, integer) to authenticated;
grant execute on function app.resolve_membership_status(public.membership_status, date, date, date) to authenticated;
grant execute on function app.renew_membership_from_plan(uuid, uuid, uuid, date) to authenticated;
grant execute on function app.membership_plan_belongs_to_gym(uuid, uuid) to authenticated;
grant execute on function app.payment_belongs_to_gym(uuid, uuid) to authenticated;

commit;
