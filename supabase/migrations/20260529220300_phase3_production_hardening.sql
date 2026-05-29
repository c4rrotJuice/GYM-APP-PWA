-- Phase 3 production hardening: tenant guards, renewal race protection, and scalable lookup indexes.

begin;

create index if not exists memberships_gym_user_active_window_idx
  on public.memberships (gym_id, user_id, start_date, end_date, created_at desc)
  where status in ('active', 'pending');

create index if not exists memberships_gym_expiry_active_idx
  on public.memberships (gym_id, end_date, created_at)
  where status = 'active';

create index if not exists memberships_gym_pending_start_idx
  on public.memberships (gym_id, start_date, end_date, created_at)
  where status = 'pending';

create index if not exists payments_gym_user_created_idx
  on public.payments (gym_id, user_id, created_at desc);

create index if not exists payments_gym_completed_paid_idx
  on public.payments (gym_id, paid_at desc)
  where status = 'completed';

create unique index if not exists payments_gym_external_transaction_unique_idx
  on public.payments (gym_id, external_provider, external_transaction_id)
  where external_provider is not null and external_transaction_id is not null;

create or replace function app.user_is_active_member_of_gym(target_user_id uuid, target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = target_user_id
      and u.gym_id = target_gym_id
      and u.role = 'member'
      and u.account_status = 'active'
  )
$$;

create or replace function app.lock_member_membership_state(target_gym_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_gym_id is null or target_user_id is null then
    raise exception 'gym and member are required for membership state locking';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_gym_id::text || ':' || target_user_id::text, 0));
end;
$$;

create or replace function app.record_membership_payment(
  target_user_id uuid,
  target_plan_id uuid,
  payment_amount numeric default null,
  payment_method text default 'cash',
  payment_reference text default null,
  payment_status public.payment_status default 'completed',
  payment_notes text default null,
  payment_paid_at timestamptz default null,
  payment_external_provider text default null,
  payment_external_transaction_id text default null,
  payment_provider_payload jsonb default '{}'::jsonb,
  as_of date default current_date
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  active_gym_id uuid;
  plan_record public.membership_plans%rowtype;
  normalized_method text;
  normalized_amount numeric(12, 2);
  payment_record public.payments%rowtype;
  membership_record public.memberships%rowtype;
begin
  active_gym_id := app.current_gym_id();

  if not app.user_is_admin() or active_gym_id is null then
    raise exception 'only active admins can record payments';
  end if;

  perform app.lock_member_membership_state(active_gym_id, target_user_id);

  select *
  into plan_record
  from public.membership_plans
  where id = target_plan_id
    and gym_id = active_gym_id
    and active = true;

  if not found then
    raise exception 'membership plan is not active in this gym';
  end if;

  if not app.user_is_active_member_of_gym(target_user_id, active_gym_id) then
    raise exception 'target user must be an active member in the active gym';
  end if;

  normalized_method := coalesce(nullif(trim(payment_method), ''), 'cash');
  if normalized_method not in ('cash', 'card', 'mobile_money', 'bank_transfer', 'other') then
    raise exception 'unsupported payment method';
  end if;

  if payment_external_provider is not null
    and nullif(trim(payment_external_provider), '') is not null
    and nullif(trim(payment_reference), '') is null
    and nullif(trim(payment_external_transaction_id), '') is null then
    raise exception 'external payments require a reference or transaction id';
  end if;

  normalized_amount := coalesce(payment_amount, plan_record.price);
  if normalized_amount is null or normalized_amount <= 0 then
    raise exception 'payment amount must be greater than zero';
  end if;

  insert into public.payments (
    gym_id,
    user_id,
    amount,
    method,
    reference,
    status,
    notes,
    paid_at,
    created_by,
    external_provider,
    external_transaction_id,
    provider_payload
  )
  values (
    active_gym_id,
    target_user_id,
    normalized_amount,
    normalized_method,
    nullif(trim(payment_reference), ''),
    payment_status,
    nullif(trim(payment_notes), ''),
    case when payment_status = 'completed' then coalesce(payment_paid_at, now()) else payment_paid_at end,
    auth.uid(),
    nullif(trim(payment_external_provider), ''),
    nullif(trim(payment_external_transaction_id), ''),
    coalesce(payment_provider_payload, '{}'::jsonb)
  )
  returning * into payment_record;

  if payment_status = 'completed' then
    membership_record := app.renew_membership_from_plan(target_user_id, target_plan_id, payment_record.id, as_of);

    update public.payments
    set membership_id = membership_record.id
    where id = payment_record.id
    returning * into payment_record;
  end if;

  return payment_record;
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
  payment_record public.payments%rowtype;
  next_start date;
  next_end date;
  next_status public.membership_status;
  result public.memberships%rowtype;
begin
  active_gym_id := app.current_gym_id();

  if not app.user_is_admin() or active_gym_id is null then
    raise exception 'only active admins can assign membership plans';
  end if;

  perform app.lock_member_membership_state(active_gym_id, target_user_id);

  select *
  into plan_record
  from public.membership_plans
  where id = target_plan_id
    and gym_id = active_gym_id
    and active = true;

  if not found then
    raise exception 'membership plan is not active in this gym';
  end if;

  if not app.user_is_active_member_of_gym(target_user_id, active_gym_id) then
    raise exception 'target user must be an active member in the active gym';
  end if;

  if target_payment_id is not null then
    select *
    into payment_record
    from public.payments
    where id = target_payment_id
      and gym_id = active_gym_id
      and user_id = target_user_id;

    if not found then
      raise exception 'payment must belong to the active gym and member';
    end if;

    if payment_record.status <> 'completed' then
      raise exception 'only completed payments can activate or renew memberships';
    end if;
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
      'payment_id', target_payment_id,
      'renewed_from_membership_id', previous_membership.id
    )
  );

  return result;
end;
$$;

revoke execute on function app.user_is_active_member_of_gym(uuid, uuid) from public, authenticated;
revoke execute on function app.lock_member_membership_state(uuid, uuid) from public, authenticated;

commit;
