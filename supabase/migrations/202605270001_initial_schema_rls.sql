-- Gym Management PWA - initial Supabase schema and RLS foundation.
-- Apply from the Supabase SQL editor or with `supabase db push`.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'trainer', 'member');
  end if;

  if not exists (select 1 from pg_type where typname = 'membership_status') then
    create type public.membership_status as enum ('pending', 'active', 'expired', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'qr_validity_type') then
    create type public.qr_validity_type as enum ('weekly', 'fortnightly', 'monthly');
  end if;

  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type public.attendance_status as enum ('success', 'failed', 'rejected');
  end if;
end
$$;

create schema if not exists app;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  fullname text not null check (length(trim(fullname)) > 0),
  email text not null,
  phone text,
  role public.app_role not null default 'member',
  assigned_trainer uuid references public.users(id) on delete set null,
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_assigned_trainer_not_self check (assigned_trainer is null or assigned_trainer <> id)
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (length(trim(type)) > 0),
  start_date date not null,
  end_date date not null,
  status public.membership_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_date_range_valid check (end_date >= start_date)
);

create table if not exists public.attendance_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (length(trim(token)) >= 24),
  validity_type public.qr_validity_type not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  generated_by uuid not null references public.users(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint attendance_qr_tokens_expiry_valid check (expires_at > issued_at)
);

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  qr_token_id uuid not null references public.attendance_qr_tokens(id) on delete restrict,
  scanned_at timestamptz not null default now(),
  status public.attendance_status not null default 'success',
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'card', 'mobile_money', 'bank_transfer', 'other')),
  reference text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.workout_programs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workout_id uuid not null references public.workout_programs(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (user_id, workout_id)
);

create table if not exists public.progress_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  weight numeric(6, 2) check (weight is null or weight > 0),
  notes text,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app.enforce_user_update_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app.is_admin() then
    return new;
  end if;

  if new.id <> auth.uid() then
    raise exception 'users can only update their own profile';
  end if;

  if new.role is distinct from old.role
    or new.assigned_trainer is distinct from old.assigned_trainer
    or new.account_status is distinct from old.account_status then
    raise exception 'only admins can update role, trainer assignment, or account status';
  end if;

  return new;
end;
$$;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists enforce_user_update_security on public.users;
create trigger enforce_user_update_security
before update on public.users
for each row execute function app.enforce_user_update_security();

drop trigger if exists set_memberships_updated_at on public.memberships;
create trigger set_memberships_updated_at
before update on public.memberships
for each row execute function public.set_updated_at();

drop trigger if exists set_workout_programs_updated_at on public.workout_programs;
create trigger set_workout_programs_updated_at
before update on public.workout_programs
for each row execute function public.set_updated_at();

-- Recommended indexes.
create unique index if not exists users_email_lower_idx on public.users (lower(email));
create index if not exists users_role_idx on public.users (role);
create index if not exists users_assigned_trainer_idx on public.users (assigned_trainer);
create index if not exists users_account_status_idx on public.users (account_status);

create index if not exists memberships_user_id_idx on public.memberships (user_id);
create index if not exists memberships_status_idx on public.memberships (status);
create index if not exists memberships_end_date_idx on public.memberships (end_date);
create unique index if not exists memberships_one_active_per_user_idx
  on public.memberships (user_id)
  where status = 'active';

create index if not exists attendance_qr_tokens_active_expires_idx
  on public.attendance_qr_tokens (active, expires_at);
create index if not exists attendance_qr_tokens_generated_by_idx
  on public.attendance_qr_tokens (generated_by);

create index if not exists attendance_logs_user_scanned_idx
  on public.attendance_logs (user_id, scanned_at desc);
create index if not exists attendance_logs_qr_token_id_idx
  on public.attendance_logs (qr_token_id);
create unique index if not exists attendance_logs_one_success_per_token_idx
  on public.attendance_logs (user_id, qr_token_id)
  where status = 'success';

create index if not exists payments_user_paid_idx on public.payments (user_id, paid_at desc);
create index if not exists payments_reference_idx on public.payments (reference) where reference is not null;

create index if not exists workout_programs_created_by_idx on public.workout_programs (created_by);
create index if not exists user_workouts_user_id_idx on public.user_workouts (user_id);
create index if not exists user_workouts_workout_id_idx on public.user_workouts (workout_id);
create index if not exists progress_logs_user_created_idx on public.progress_logs (user_id, created_at desc);

-- Private helper functions used by RLS. SECURITY DEFINER avoids recursive reads
-- against public.users while still basing access on the authenticated JWT uid.
create or replace function app.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.users u
  where u.id = auth.uid()
    and u.account_status = 'active'
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app.current_user_role() = 'admin', false)
$$;

create or replace function app.is_trainer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app.current_user_role() = 'trainer', false)
$$;

create or replace function app.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app.current_user_role() = 'member', false)
$$;

create or replace function app.trainer_has_member(member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = member_id
      and u.role = 'member'
      and u.account_status = 'active'
      and u.assigned_trainer = auth.uid()
      and app.is_trainer()
  )
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
      and m.status = 'active'
      and current_date between m.start_date and m.end_date
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
    and app.is_member()
    and app.user_has_active_membership(member_id)
    and app.qr_token_is_valid(qr_token_id)
$$;

create or replace function app.member_has_workout(member_id uuid, program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_workouts uw
    where uw.user_id = member_id
      and uw.workout_id = program_id
  )
$$;

create or replace function app.trainer_can_assign_workout(member_id uuid, program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.trainer_has_member(member_id)
    and exists (
      select 1
      from public.workout_programs wp
      where wp.id = program_id
        and wp.created_by = auth.uid()
    )
$$;

revoke all on schema app from public;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

alter table public.users enable row level security;
alter table public.memberships enable row level security;
alter table public.attendance_qr_tokens enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.payments enable row level security;
alter table public.workout_programs enable row level security;
alter table public.user_workouts enable row level security;
alter table public.progress_logs enable row level security;

-- No unauthenticated table exposure. Authenticated users still need table grants;
-- RLS policies below enforce least-privilege row access.
revoke all on table
  public.users,
  public.memberships,
  public.attendance_qr_tokens,
  public.attendance_logs,
  public.payments,
  public.workout_programs,
  public.user_workouts,
  public.progress_logs
from anon;

grant select, insert, update, delete on table
  public.users,
  public.memberships,
  public.attendance_qr_tokens,
  public.attendance_logs,
  public.payments,
  public.workout_programs,
  public.user_workouts,
  public.progress_logs
to authenticated;

-- users
drop policy if exists users_select_scoped on public.users;
create policy users_select_scoped
on public.users
for select
to authenticated
using (
  id = auth.uid()
  or app.is_admin()
  or app.trainer_has_member(id)
);

drop policy if exists users_admin_insert on public.users;
create policy users_admin_insert
on public.users
for insert
to authenticated
with check (app.is_admin());

drop policy if exists users_update_scoped on public.users;
create policy users_update_scoped
on public.users
for update
to authenticated
using (id = auth.uid() or app.is_admin())
with check (
  app.is_admin()
  or (
    id = auth.uid()
    and role = app.current_user_role()
    and account_status = 'active'
  )
);

drop policy if exists users_admin_delete on public.users;
create policy users_admin_delete
on public.users
for delete
to authenticated
using (app.is_admin());

-- memberships
drop policy if exists memberships_select_scoped on public.memberships;
create policy memberships_select_scoped
on public.memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or app.is_admin()
  or app.trainer_has_member(user_id)
);

drop policy if exists memberships_admin_insert on public.memberships;
create policy memberships_admin_insert
on public.memberships
for insert
to authenticated
with check (app.is_admin());

drop policy if exists memberships_admin_update on public.memberships;
create policy memberships_admin_update
on public.memberships
for update
to authenticated
using (app.is_admin())
with check (app.is_admin());

drop policy if exists memberships_admin_delete on public.memberships;
create policy memberships_admin_delete
on public.memberships
for delete
to authenticated
using (app.is_admin());

-- attendance_qr_tokens: token values are bearer-like secrets. Do not expose them
-- to members or trainers through direct table reads.
drop policy if exists attendance_qr_tokens_admin_all on public.attendance_qr_tokens;
create policy attendance_qr_tokens_admin_all
on public.attendance_qr_tokens
for all
to authenticated
using (app.is_admin())
with check (app.is_admin() and generated_by = auth.uid());

-- attendance_logs
drop policy if exists attendance_logs_select_scoped on public.attendance_logs;
create policy attendance_logs_select_scoped
on public.attendance_logs
for select
to authenticated
using (
  user_id = auth.uid()
  or app.is_admin()
  or app.trainer_has_member(user_id)
);

drop policy if exists attendance_logs_member_insert_valid_scan on public.attendance_logs;
create policy attendance_logs_member_insert_valid_scan
on public.attendance_logs
for insert
to authenticated
with check (
  status = 'success'
  and app.can_log_attendance(user_id, qr_token_id)
);

drop policy if exists attendance_logs_admin_insert on public.attendance_logs;
create policy attendance_logs_admin_insert
on public.attendance_logs
for insert
to authenticated
with check (app.is_admin());

drop policy if exists attendance_logs_admin_update on public.attendance_logs;
create policy attendance_logs_admin_update
on public.attendance_logs
for update
to authenticated
using (app.is_admin())
with check (app.is_admin());

drop policy if exists attendance_logs_admin_delete on public.attendance_logs;
create policy attendance_logs_admin_delete
on public.attendance_logs
for delete
to authenticated
using (app.is_admin());

-- payments
drop policy if exists payments_select_scoped on public.payments;
create policy payments_select_scoped
on public.payments
for select
to authenticated
using (
  user_id = auth.uid()
  or app.is_admin()
  or app.trainer_has_member(user_id)
);

drop policy if exists payments_admin_insert on public.payments;
create policy payments_admin_insert
on public.payments
for insert
to authenticated
with check (app.is_admin());

drop policy if exists payments_admin_update on public.payments;
create policy payments_admin_update
on public.payments
for update
to authenticated
using (app.is_admin())
with check (app.is_admin());

drop policy if exists payments_admin_delete on public.payments;
create policy payments_admin_delete
on public.payments
for delete
to authenticated
using (app.is_admin());

-- workout_programs
drop policy if exists workout_programs_select_scoped on public.workout_programs;
create policy workout_programs_select_scoped
on public.workout_programs
for select
to authenticated
using (
  app.is_admin()
  or created_by = auth.uid()
  or app.member_has_workout(auth.uid(), id)
);

drop policy if exists workout_programs_trainer_admin_insert on public.workout_programs;
create policy workout_programs_trainer_admin_insert
on public.workout_programs
for insert
to authenticated
with check (
  app.is_admin()
  or (app.is_trainer() and created_by = auth.uid())
);

drop policy if exists workout_programs_trainer_admin_update on public.workout_programs;
create policy workout_programs_trainer_admin_update
on public.workout_programs
for update
to authenticated
using (app.is_admin() or (app.is_trainer() and created_by = auth.uid()))
with check (app.is_admin() or (app.is_trainer() and created_by = auth.uid()));

drop policy if exists workout_programs_trainer_admin_delete on public.workout_programs;
create policy workout_programs_trainer_admin_delete
on public.workout_programs
for delete
to authenticated
using (app.is_admin() or (app.is_trainer() and created_by = auth.uid()));

-- user_workouts
drop policy if exists user_workouts_select_scoped on public.user_workouts;
create policy user_workouts_select_scoped
on public.user_workouts
for select
to authenticated
using (
  user_id = auth.uid()
  or app.is_admin()
  or app.trainer_has_member(user_id)
);

drop policy if exists user_workouts_trainer_admin_insert on public.user_workouts;
create policy user_workouts_trainer_admin_insert
on public.user_workouts
for insert
to authenticated
with check (
  app.is_admin()
  or app.trainer_can_assign_workout(user_id, workout_id)
);

drop policy if exists user_workouts_trainer_admin_update on public.user_workouts;
create policy user_workouts_trainer_admin_update
on public.user_workouts
for update
to authenticated
using (app.is_admin() or app.trainer_has_member(user_id))
with check (app.is_admin() or app.trainer_can_assign_workout(user_id, workout_id));

drop policy if exists user_workouts_trainer_admin_delete on public.user_workouts;
create policy user_workouts_trainer_admin_delete
on public.user_workouts
for delete
to authenticated
using (app.is_admin() or app.trainer_has_member(user_id));

-- progress_logs
drop policy if exists progress_logs_select_scoped on public.progress_logs;
create policy progress_logs_select_scoped
on public.progress_logs
for select
to authenticated
using (
  user_id = auth.uid()
  or app.is_admin()
  or app.trainer_has_member(user_id)
);

drop policy if exists progress_logs_member_trainer_admin_insert on public.progress_logs;
create policy progress_logs_member_trainer_admin_insert
on public.progress_logs
for insert
to authenticated
with check (
  user_id = auth.uid()
  or app.is_admin()
  or app.trainer_has_member(user_id)
);

drop policy if exists progress_logs_member_trainer_admin_update on public.progress_logs;
create policy progress_logs_member_trainer_admin_update
on public.progress_logs
for update
to authenticated
using (
  user_id = auth.uid()
  or app.is_admin()
  or app.trainer_has_member(user_id)
)
with check (
  user_id = auth.uid()
  or app.is_admin()
  or app.trainer_has_member(user_id)
);

drop policy if exists progress_logs_admin_delete on public.progress_logs;
create policy progress_logs_admin_delete
on public.progress_logs
for delete
to authenticated
using (app.is_admin());

commit;
