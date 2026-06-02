-- Phase 5 automation foundation.
-- Adds durable failure logs, notification retry metadata, and service-role RPCs for scheduled jobs.

begin;

alter table public.notification_queue
  add column if not exists last_error text,
  add column if not exists last_attempt_at timestamptz;

create index if not exists notification_queue_retry_idx
  on public.notification_queue (status, attempt_count, created_at);

create table if not exists public.automation_failures (
  id uuid primary key default gen_random_uuid(),
  job_name text not null check (length(trim(job_name)) > 0),
  gym_id uuid references public.gyms(id) on delete set null,
  error_message text not null,
  error_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists automation_failures_job_created_idx
  on public.automation_failures (job_name, created_at desc);

create index if not exists automation_failures_gym_created_idx
  on public.automation_failures (gym_id, created_at desc);

alter table public.automation_failures enable row level security;

revoke all on table public.automation_failures from anon;
grant select on table public.automation_failures to authenticated;

drop policy if exists automation_failures_admin_select on public.automation_failures;
create policy automation_failures_admin_select
on public.automation_failures
for select
to authenticated
using (
  app.user_is_admin()
  and (
    gym_id is null
    or gym_id = app.current_gym_id()
  )
);

create or replace function public.run_daily_statistics_automation(stat_on date default current_date)
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
  gym_record record;
  calculated record;
  result public.daily_statistics%rowtype;
begin
  for gym_record in select id from public.gyms loop
    select *
    into calculated
    from app.calculate_daily_statistics_for_gym(gym_record.id, coalesce(stat_on, current_date));

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

    gym_id := result.gym_id;
    stat_date := result.stat_date;
    active_members := result.active_members;
    attendance_count := result.attendance_count;
    revenue_amount := result.revenue_amount;
    inactive_members := result.inactive_members;
    return next;
  end loop;
end;
$$;

create or replace function public.run_membership_expiry_automation(
  as_of date default current_date,
  expiry_window_days integer default 7
)
returns table (
  gym_id uuid,
  expired_count integer,
  activated_count integer,
  pending_count integer,
  notification_triggers_prepared integer
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  gym_record record;
  result record;
begin
  for gym_record in select id from public.gyms loop
    select *
    into result
    from app.process_membership_expiry(gym_record.id, coalesce(as_of, current_date), coalesce(expiry_window_days, 7));

    gym_id := gym_record.id;
    expired_count := coalesce(result.expired_count, 0);
    activated_count := coalesce(result.activated_count, 0);
    pending_count := coalesce(result.pending_count, 0);
    notification_triggers_prepared := coalesce(result.notification_triggers_prepared, 0);
    return next;
  end loop;
end;
$$;

revoke execute on function public.run_daily_statistics_automation(date) from public, anon, authenticated;
revoke execute on function public.run_membership_expiry_automation(date, integer) from public, anon, authenticated;

grant execute on function public.run_daily_statistics_automation(date) to service_role;
grant execute on function public.run_membership_expiry_automation(date, integer) to service_role;

commit;
