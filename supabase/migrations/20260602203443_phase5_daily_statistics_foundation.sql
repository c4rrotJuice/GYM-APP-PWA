-- Phase 5 - Daily analytics statistics foundation.

begin;

create table if not exists public.daily_statistics (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete restrict,
  stat_date date not null,
  active_members integer not null default 0 check (active_members >= 0),
  attendance_count integer not null default 0 check (attendance_count >= 0),
  revenue_amount numeric(12, 2) not null default 0 check (revenue_amount >= 0),
  inactive_members integer not null default 0 check (inactive_members >= 0),
  created_at timestamptz not null default now(),
  unique (gym_id, stat_date)
);

create index if not exists daily_statistics_gym_id_idx on public.daily_statistics (gym_id);
create index if not exists daily_statistics_stat_date_idx on public.daily_statistics (stat_date);
create index if not exists daily_statistics_gym_stat_date_idx on public.daily_statistics (gym_id, stat_date desc);

alter table public.daily_statistics enable row level security;

revoke all on table public.daily_statistics from anon;
grant select, insert, update on table public.daily_statistics to authenticated;

drop policy if exists daily_statistics_select_scoped on public.daily_statistics;
create policy daily_statistics_select_scoped
on public.daily_statistics
for select
to authenticated
using (
  gym_id = app.current_gym_id()
  and app.user_is_admin()
);

drop policy if exists daily_statistics_admin_insert on public.daily_statistics;
create policy daily_statistics_admin_insert
on public.daily_statistics
for insert
to authenticated
with check (
  gym_id = app.current_gym_id()
  and app.user_is_admin()
);

drop policy if exists daily_statistics_admin_update on public.daily_statistics;
create policy daily_statistics_admin_update
on public.daily_statistics
for update
to authenticated
using (
  gym_id = app.current_gym_id()
  and app.user_is_admin()
)
with check (
  gym_id = app.current_gym_id()
  and app.user_is_admin()
);

create or replace view public.daily_statistics_calculation_source
with (security_invoker = true)
as
select
  g.id as gym_id,
  current_date as stat_date,
  (
    select count(distinct m.user_id)::integer
    from public.memberships m
    join public.users u on u.id = m.user_id
    where m.gym_id = g.id
      and u.gym_id = g.id
      and u.role = 'member'::public.app_role
      and u.account_status = 'active'
      and app.resolve_membership_status(m.status, m.start_date, m.end_date, current_date) = 'active'::public.membership_status
  ) as active_members,
  (
    select count(*)::integer
    from public.attendance_logs l
    where l.gym_id = g.id
      and l.attendance_date = current_date
  ) as attendance_count,
  (
    select coalesce(sum(p.amount), 0)::numeric(12, 2)
    from public.payments p
    where p.gym_id = g.id
      and p.status = 'completed'::public.payment_status
      and p.paid_at::date = current_date
  ) as revenue_amount,
  (
    select count(*)::integer
    from public.users u
    where u.gym_id = g.id
      and u.role = 'member'::public.app_role
      and u.account_status = 'active'
      and not exists (
        select 1
        from public.memberships m
        where m.gym_id = g.id
          and m.user_id = u.id
          and app.resolve_membership_status(m.status, m.start_date, m.end_date, current_date) = 'active'::public.membership_status
      )
  ) as inactive_members
from public.gyms g;

grant select on public.daily_statistics_calculation_source to authenticated;

create or replace function app.calculate_daily_statistics_for_gym(
  target_gym_id uuid,
  target_date date
)
returns table (
  gym_id uuid,
  stat_date date,
  active_members integer,
  attendance_count integer,
  revenue_amount numeric,
  inactive_members integer
)
language sql
stable
security definer
set search_path = public, app
as $$
  select
    target_gym_id,
    target_date,
    (
      select count(distinct m.user_id)::integer
      from public.memberships m
      join public.users u on u.id = m.user_id
      where m.gym_id = target_gym_id
        and u.gym_id = target_gym_id
        and u.role = 'member'::public.app_role
        and u.account_status = 'active'
        and app.resolve_membership_status(m.status, m.start_date, m.end_date, target_date) = 'active'::public.membership_status
    ),
    (
      select count(*)::integer
      from public.attendance_logs l
      where l.gym_id = target_gym_id
        and l.attendance_date = target_date
    ),
    (
      select coalesce(sum(p.amount), 0)::numeric(12, 2)
      from public.payments p
      where p.gym_id = target_gym_id
        and p.status = 'completed'::public.payment_status
        and p.paid_at::date = target_date
    ),
    (
      select count(*)::integer
      from public.users u
      where u.gym_id = target_gym_id
        and u.role = 'member'::public.app_role
        and u.account_status = 'active'
        and not exists (
          select 1
          from public.memberships m
          where m.gym_id = target_gym_id
            and m.user_id = u.id
            and app.resolve_membership_status(m.status, m.start_date, m.end_date, target_date) = 'active'::public.membership_status
        )
    );
$$;

create or replace function public.calculate_daily_stats(stat_on date default current_date)
returns table (
  gym_id uuid,
  stat_date date,
  active_members integer,
  attendance_count integer,
  revenue_amount numeric,
  inactive_members integer
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  active_gym_id uuid;
begin
  active_gym_id := app.current_gym_id();

  if not app.user_is_admin() or active_gym_id is null then
    raise exception 'only active admins can calculate daily statistics';
  end if;

  return query
  select *
  from app.calculate_daily_statistics_for_gym(active_gym_id, coalesce(stat_on, current_date));
end;
$$;

create or replace function public.upsert_daily_stats(stat_on date default current_date)
returns public.daily_statistics
language plpgsql
security definer
set search_path = public, app
as $$
declare
  calculated record;
  result public.daily_statistics%rowtype;
begin
  select *
  into calculated
  from public.calculate_daily_stats(coalesce(stat_on, current_date));

  insert into public.daily_statistics (
    gym_id,
    stat_date,
    active_members,
    attendance_count,
    revenue_amount,
    inactive_members
  )
  values (
    calculated.gym_id,
    calculated.stat_date,
    calculated.active_members,
    calculated.attendance_count,
    calculated.revenue_amount,
    calculated.inactive_members
  )
  on conflict (gym_id, stat_date)
  do update set
    active_members = excluded.active_members,
    attendance_count = excluded.attendance_count,
    revenue_amount = excluded.revenue_amount,
    inactive_members = excluded.inactive_members
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.calculate_daily_stats(date) from public, anon;
grant execute on function public.calculate_daily_stats(date) to authenticated;

revoke execute on function public.upsert_daily_stats(date) from public, anon;
grant execute on function public.upsert_daily_stats(date) to authenticated;

grant execute on function app.calculate_daily_statistics_for_gym(uuid, date) to authenticated;

commit;
