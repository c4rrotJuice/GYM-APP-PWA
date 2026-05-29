-- Phase 3.2 hotfix - expose membership workflow RPCs through public schema.
-- The implementation stays in app.* where authorization and tenant checks live.

begin;

create or replace function public.renew_membership_from_plan(
  target_user_id uuid,
  target_plan_id uuid,
  target_payment_id uuid default null,
  as_of date default current_date
)
returns public.memberships
language sql
security invoker
set search_path = public, app
as $$
  select app.renew_membership_from_plan(target_user_id, target_plan_id, target_payment_id, as_of);
$$;

create or replace function public.suspend_membership(
  target_membership_id uuid,
  reason text default null
)
returns public.memberships
language sql
security invoker
set search_path = public, app
as $$
  select app.suspend_membership(target_membership_id, reason);
$$;

create or replace function public.reactivate_membership(
  target_membership_id uuid,
  as_of date default current_date
)
returns public.memberships
language sql
security invoker
set search_path = public, app
as $$
  select app.reactivate_membership(target_membership_id, as_of);
$$;

create or replace function public.memberships_expiring_soon(
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
language sql
security invoker
set search_path = public, app
as $$
  select *
  from app.memberships_expiring_soon(app.current_gym_id(), window_days, as_of);
$$;

grant execute on function public.renew_membership_from_plan(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.suspend_membership(uuid, text) to authenticated;
grant execute on function public.reactivate_membership(uuid, date) to authenticated;
grant execute on function public.memberships_expiring_soon(integer, date) to authenticated;

commit;
