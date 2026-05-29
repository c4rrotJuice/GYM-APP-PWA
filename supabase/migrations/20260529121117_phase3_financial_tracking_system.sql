-- Phase 3.3 - Financial tracking, membership payment linkage, and summaries.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('completed', 'pending', 'failed', 'refunded');
  end if;
end
$$;

alter table public.payments add column if not exists membership_id uuid references public.memberships(id) on delete restrict;
alter table public.payments add column if not exists status public.payment_status not null default 'completed';
alter table public.payments add column if not exists notes text;
alter table public.payments add column if not exists created_by uuid references public.users(id) on delete set null;
alter table public.payments add column if not exists external_provider text;
alter table public.payments add column if not exists external_transaction_id text;
alter table public.payments add column if not exists provider_payload jsonb not null default '{}'::jsonb;

alter table public.payments alter column method set default 'cash';
alter table public.payments alter column paid_at drop not null;

update public.payments
set
  status = coalesce(status, 'completed'::public.payment_status),
  method = coalesce(nullif(trim(method), ''), 'cash'),
  created_by = coalesce(created_by, user_id),
  paid_at = coalesce(paid_at, created_at)
where status is null
  or method is null
  or created_by is null
  or paid_at is null;

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'card', 'mobile_money', 'bank_transfer', 'other'));
alter table public.payments add constraint payments_paid_at_required_when_completed
  check (status <> 'completed' or paid_at is not null);
alter table public.payments add constraint payments_external_provider_requires_reference
  check (external_provider is null or reference is not null or external_transaction_id is not null);

create index if not exists payments_gym_status_paid_idx on public.payments (gym_id, status, paid_at desc);
create index if not exists payments_gym_membership_idx on public.payments (gym_id, membership_id);
create index if not exists payments_gym_created_idx on public.payments (gym_id, created_at desc);
create index if not exists payments_external_provider_reference_idx
  on public.payments (external_provider, reference)
  where external_provider is not null or reference is not null;

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

create or replace function app.membership_belongs_to_gym(membership_id uuid, target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select membership_id is null or exists (
    select 1
    from public.memberships m
    where m.id = membership_id
      and m.gym_id = target_gym_id
  )
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
  elsif tg_table_name = 'payments' then
    if not app.user_belongs_to_gym(new.user_id, new.gym_id) then
      raise exception 'payments user_id must belong to the row gym';
    end if;

    if new.created_by is not null and not app.user_belongs_to_gym(new.created_by, new.gym_id) then
      raise exception 'payments created_by must belong to the row gym';
    end if;

    if not app.membership_belongs_to_gym(new.membership_id, new.gym_id) then
      raise exception 'payments membership_id must belong to the row gym';
    end if;
  elsif tg_table_name = 'progress_logs' then
    if not app.user_belongs_to_gym(new.user_id, new.gym_id) then
      raise exception 'progress_logs user_id must belong to the row gym';
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

create or replace function app.enforce_payment_audit_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payment records cannot be deleted';
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('completed', 'failed', 'refunded') and (
      new.user_id is distinct from old.user_id
      or (
        new.membership_id is distinct from old.membership_id
        and old.membership_id is not null
      )
      or new.amount is distinct from old.amount
      or new.method is distinct from old.method
      or new.reference is distinct from old.reference
      or new.status is distinct from old.status
      or new.paid_at is distinct from old.paid_at
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.external_provider is distinct from old.external_provider
      or new.external_transaction_id is distinct from old.external_transaction_id
      or new.provider_payload is distinct from old.provider_payload
    ) then
      raise exception 'finalized payment records are immutable';
    end if;

    if old.status = 'pending' and new.status not in ('pending', 'completed', 'failed') then
      raise exception 'pending payments may only remain pending, complete, or fail';
    end if;

    if old.created_at is distinct from new.created_at then
      raise exception 'payment created_at cannot be changed';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_payments_tenant_integrity on public.payments;
create trigger enforce_payments_tenant_integrity
before insert or update on public.payments
for each row execute function app.enforce_tenant_row_integrity();

drop trigger if exists enforce_payment_audit_integrity on public.payments;
create trigger enforce_payment_audit_integrity
before update or delete on public.payments
for each row execute function app.enforce_payment_audit_integrity();

drop policy if exists payments_select_scoped on public.payments;
create policy payments_select_scoped
on public.payments
for select
to authenticated
using (
  gym_id = app.current_gym_id()
  and (
    user_id = auth.uid()
    or app.user_is_admin()
  )
);

drop policy if exists payments_admin_insert on public.payments;
create policy payments_admin_insert
on public.payments
for insert
to authenticated
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and app.user_belongs_to_gym(user_id, gym_id)
  and created_by = auth.uid()
);

drop policy if exists payments_admin_update on public.payments;
create policy payments_admin_update
on public.payments
for update
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id())
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and app.user_belongs_to_gym(user_id, gym_id)
);

drop policy if exists payments_admin_delete on public.payments;
create policy payments_admin_delete
on public.payments
for delete
to authenticated
using (false);

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

  normalized_method := coalesce(nullif(trim(payment_method), ''), 'cash');
  if normalized_method not in ('cash', 'card', 'mobile_money', 'bank_transfer', 'other') then
    raise exception 'unsupported payment method';
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

create or replace function app.financial_summary(
  target_gym_id uuid default app.current_gym_id(),
  as_of date default current_date
)
returns table (
  total_revenue numeric,
  monthly_revenue numeric,
  pending_balances numeric,
  recent_transactions jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.user_is_admin() or target_gym_id is distinct from app.current_gym_id() then
    raise exception 'only active admins can view gym financial summaries';
  end if;

  return query
  with membership_balances as (
    select
      m.id,
      greatest(coalesce(mp.price, 0) - coalesce(sum(p.amount) filter (where p.status = 'completed'), 0), 0) as outstanding
    from public.memberships m
    left join public.membership_plans mp on mp.id = m.membership_plan_id and mp.gym_id = m.gym_id
    left join public.payments p on p.membership_id = m.id and p.gym_id = m.gym_id
    where m.gym_id = target_gym_id
      and m.status in ('active', 'pending')
    group by m.id, mp.price
  ),
  pending_payments as (
    select coalesce(sum(amount), 0) as amount
    from public.payments
    where gym_id = target_gym_id
      and status = 'pending'
  ),
  recent as (
    select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb) as rows
    from (
      select
        p.id,
        p.user_id,
        p.membership_id,
        p.amount,
        p.method,
        p.reference,
        p.status,
        p.paid_at,
        p.created_at
      from public.payments p
      where p.gym_id = target_gym_id
      order by p.created_at desc
      limit 8
    ) t
  )
  select
    coalesce(sum(p.amount) filter (where p.status = 'completed'), 0)::numeric as total_revenue,
    coalesce(sum(p.amount) filter (
      where p.status = 'completed'
        and p.paid_at >= date_trunc('month', as_of::timestamp)
        and p.paid_at < (date_trunc('month', as_of::timestamp) + interval '1 month')
    ), 0)::numeric as monthly_revenue,
    (
      (select coalesce(sum(outstanding), 0) from membership_balances)
      + (select amount from pending_payments)
    )::numeric as pending_balances,
    (select rows from recent) as recent_transactions
  from public.payments p
  where p.gym_id = target_gym_id;
end;
$$;

create or replace function app.outstanding_membership_balances(
  target_gym_id uuid default app.current_gym_id()
)
returns table (
  user_id uuid,
  membership_id uuid,
  plan_name text,
  plan_price numeric,
  paid_amount numeric,
  pending_amount numeric,
  outstanding_amount numeric,
  membership_status public.membership_status,
  membership_end_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.user_is_admin() or target_gym_id is distinct from app.current_gym_id() then
    raise exception 'only active admins can view outstanding balances';
  end if;

  return query
  select
    m.user_id,
    m.id as membership_id,
    coalesce(mp.name, m.type) as plan_name,
    coalesce(mp.price, 0)::numeric as plan_price,
    coalesce(sum(p.amount) filter (where p.status = 'completed'), 0)::numeric as paid_amount,
    coalesce(sum(p.amount) filter (where p.status = 'pending'), 0)::numeric as pending_amount,
    greatest(coalesce(mp.price, 0) - coalesce(sum(p.amount) filter (where p.status = 'completed'), 0), 0)::numeric as outstanding_amount,
    m.status as membership_status,
    m.end_date as membership_end_date
  from public.memberships m
  left join public.membership_plans mp on mp.id = m.membership_plan_id and mp.gym_id = m.gym_id
  left join public.payments p on p.membership_id = m.id and p.gym_id = m.gym_id
  where m.gym_id = target_gym_id
    and m.status in ('active', 'pending')
  group by m.user_id, m.id, mp.name, mp.price, m.type, m.status, m.end_date
  having greatest(coalesce(mp.price, 0) - coalesce(sum(p.amount) filter (where p.status = 'completed'), 0), 0) > 0
  order by outstanding_amount desc, m.end_date asc;
end;
$$;

create or replace function public.record_membership_payment(
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
language sql
security invoker
set search_path = public, app
as $$
  select app.record_membership_payment(
    target_user_id,
    target_plan_id,
    payment_amount,
    payment_method,
    payment_reference,
    payment_status,
    payment_notes,
    payment_paid_at,
    payment_external_provider,
    payment_external_transaction_id,
    payment_provider_payload,
    as_of
  );
$$;

create or replace function public.financial_summary(as_of date default current_date)
returns table (
  total_revenue numeric,
  monthly_revenue numeric,
  pending_balances numeric,
  recent_transactions jsonb
)
language sql
security invoker
set search_path = public, app
as $$
  select * from app.financial_summary(app.current_gym_id(), as_of);
$$;

create or replace function public.outstanding_membership_balances()
returns table (
  user_id uuid,
  membership_id uuid,
  plan_name text,
  plan_price numeric,
  paid_amount numeric,
  pending_amount numeric,
  outstanding_amount numeric,
  membership_status public.membership_status,
  membership_end_date date
)
language sql
security invoker
set search_path = public, app
as $$
  select * from app.outstanding_membership_balances(app.current_gym_id());
$$;

grant execute on function public.record_membership_payment(uuid, uuid, numeric, text, text, public.payment_status, text, timestamptz, text, text, jsonb, date) to authenticated;
grant execute on function public.financial_summary(date) to authenticated;
grant execute on function public.outstanding_membership_balances() to authenticated;
grant execute on function app.record_membership_payment(uuid, uuid, numeric, text, text, public.payment_status, text, timestamptz, text, text, jsonb, date) to authenticated;
grant execute on function app.financial_summary(uuid, date) to authenticated;
grant execute on function app.outstanding_membership_balances(uuid) to authenticated;

commit;
