-- Phase 4 - Attendance and QR database foundation.
-- This migration upgrades the existing attendance foundation to daily attendance
-- tracking while keeping all access control tenant-scoped through app helpers.

begin;

create extension if not exists pgcrypto;

create table if not exists public.attendance_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete restrict,
  token text not null unique,
  validity_type text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  generated_by uuid not null references public.users(id) on delete restrict,
  active boolean not null default true,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_qr_tokens_expiry_valid check (expires_at > issued_at),
  constraint attendance_qr_tokens_token_present check (length(trim(token)) > 0),
  constraint attendance_qr_tokens_validity_type_present check (length(trim(validity_type)) > 0)
);

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete cascade,
  qr_token_id uuid not null references public.attendance_qr_tokens(id) on delete restrict,
  attendance_date date not null,
  attended_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  source text not null,
  notes text,
  constraint attendance_logs_source_present check (length(trim(source)) > 0)
);

-- Existing installations already have attendance tables from the Phase 1/2
-- foundation. Keep this migration idempotent and upgrade those tables in place.
alter table public.attendance_qr_tokens
  add column if not exists gym_id uuid references public.gyms(id) on delete restrict,
  add column if not exists revoked_at timestamptz;

alter table public.attendance_qr_tokens
  alter column id set default gen_random_uuid(),
  alter column issued_at set default now(),
  alter column active set default true,
  alter column created_at set default now();

alter table public.attendance_qr_tokens
  alter column validity_type type text using validity_type::text;

alter table public.attendance_qr_tokens
  alter column token set not null,
  alter column validity_type set not null,
  alter column issued_at set not null,
  alter column expires_at set not null,
  alter column generated_by set not null,
  alter column active set not null,
  alter column created_at set not null;

alter table public.attendance_logs
  add column if not exists gym_id uuid references public.gyms(id) on delete restrict,
  add column if not exists attendance_date date,
  add column if not exists attended_at timestamptz,
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists source text,
  add column if not exists notes text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attendance_logs'
      and column_name = 'scanned_at'
  ) then
    update public.attendance_logs
    set
      attended_at = coalesce(attended_at, scanned_at, now()),
      attendance_date = coalesce(attendance_date, (coalesce(attended_at, scanned_at, now()))::date),
      source = coalesce(nullif(trim(source), ''), 'qr')
    where attended_at is null
      or attendance_date is null
      or source is null
      or trim(source) = '';
  else
    update public.attendance_logs
    set
      attended_at = coalesce(attended_at, now()),
      attendance_date = coalesce(attendance_date, (coalesce(attended_at, now()))::date),
      source = coalesce(nullif(trim(source), ''), 'qr')
    where attended_at is null
      or attendance_date is null
      or source is null
      or trim(source) = '';
  end if;
end
$$;

alter table public.attendance_logs
  alter column id set default gen_random_uuid(),
  alter column attended_at set default now();

alter table public.attendance_logs
  alter column gym_id set not null,
  alter column user_id set not null,
  alter column qr_token_id set not null,
  alter column attendance_date set not null,
  alter column attended_at set not null,
  alter column source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_qr_tokens_token_present'
      and conrelid = 'public.attendance_qr_tokens'::regclass
  ) then
    alter table public.attendance_qr_tokens
      add constraint attendance_qr_tokens_token_present check (length(trim(token)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_qr_tokens_validity_type_present'
      and conrelid = 'public.attendance_qr_tokens'::regclass
  ) then
    alter table public.attendance_qr_tokens
      add constraint attendance_qr_tokens_validity_type_present check (length(trim(validity_type)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_logs_source_present'
      and conrelid = 'public.attendance_logs'::regclass
  ) then
    alter table public.attendance_logs
      add constraint attendance_logs_source_present check (length(trim(source)) > 0);
  end if;
end
$$;

-- Daily uniqueness is the Phase 4 attendance invariant: one attendance record
-- per member per gym calendar day, regardless of token rotation.
drop index if exists public.attendance_logs_one_success_per_token_idx;
create unique index if not exists attendance_logs_one_per_member_day_idx
  on public.attendance_logs (gym_id, user_id, attendance_date);

create index if not exists attendance_qr_tokens_gym_id_idx
  on public.attendance_qr_tokens (gym_id);
create index if not exists attendance_qr_tokens_active_expires_idx
  on public.attendance_qr_tokens (active, expires_at);
create index if not exists attendance_qr_tokens_gym_active_expires_idx
  on public.attendance_qr_tokens (gym_id, active, expires_at);
create index if not exists attendance_qr_tokens_generated_by_idx
  on public.attendance_qr_tokens (generated_by);
create index if not exists attendance_logs_gym_id_idx
  on public.attendance_logs (gym_id);
create index if not exists attendance_logs_qr_token_id_idx
  on public.attendance_logs (qr_token_id);
create index if not exists attendance_logs_gym_user_attended_idx
  on public.attendance_logs (gym_id, user_id, attended_at desc);
create index if not exists attendance_logs_created_by_idx
  on public.attendance_logs (created_by);

comment on table public.attendance_qr_tokens is
  'QR tokens issued by gym admins for attendance capture. Tokens are scoped by gym and can be revoked without deleting history.';
comment on column public.attendance_qr_tokens.validity_type is
  'Text label for the token validity window, e.g. daily, weekly, monthly, or a future business-defined value.';
comment on column public.attendance_qr_tokens.revoked_at is
  'Timestamp set when an admin revokes a token. Revoked tokens should also have active = false.';
comment on table public.attendance_logs is
  'Daily member attendance records produced from a QR token or an approved administrative source.';
comment on column public.attendance_logs.attendance_date is
  'Calendar date used for the one-attendance-per-member-per-day invariant.';
comment on column public.attendance_logs.source is
  'Origin of the attendance record, such as qr or admin. Scanner/service implementation is intentionally outside this migration.';

alter table public.attendance_qr_tokens enable row level security;
alter table public.attendance_logs enable row level security;

revoke all on table public.attendance_qr_tokens from anon;
revoke all on table public.attendance_logs from anon;
revoke all on table public.attendance_qr_tokens from authenticated;
revoke all on table public.attendance_logs from authenticated;
grant select, insert, update, delete on table public.attendance_qr_tokens to authenticated;
grant select, insert, update, delete on table public.attendance_logs to authenticated;

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
      and t.revoked_at is null
      and now() between t.issued_at and t.expires_at
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

drop trigger if exists enforce_attendance_qr_tokens_tenant_integrity on public.attendance_qr_tokens;
create trigger enforce_attendance_qr_tokens_tenant_integrity
before insert or update on public.attendance_qr_tokens
for each row execute function app.enforce_tenant_row_integrity();

drop trigger if exists enforce_attendance_logs_tenant_integrity on public.attendance_logs;
create trigger enforce_attendance_logs_tenant_integrity
before insert or update on public.attendance_logs
for each row execute function app.enforce_tenant_row_integrity();

drop policy if exists attendance_qr_tokens_admin_all on public.attendance_qr_tokens;
drop policy if exists attendance_qr_tokens_admin_write on public.attendance_qr_tokens;
drop policy if exists attendance_qr_tokens_trainer_read on public.attendance_qr_tokens;
drop policy if exists attendance_qr_tokens_member_read_active on public.attendance_qr_tokens;

create policy attendance_qr_tokens_admin_write
on public.attendance_qr_tokens
for all
to authenticated
using (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
)
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and generated_by = auth.uid()
);

create policy attendance_qr_tokens_trainer_read
on public.attendance_qr_tokens
for select
to authenticated
using (
  app.user_is_trainer()
  and gym_id = app.current_gym_id()
);

create policy attendance_qr_tokens_member_read_active
on public.attendance_qr_tokens
for select
to authenticated
using (
  app.user_is_member()
  and gym_id = app.current_gym_id()
  and active = true
  and revoked_at is null
);

drop policy if exists attendance_logs_select_scoped on public.attendance_logs;
drop policy if exists attendance_logs_member_insert_valid_scan on public.attendance_logs;
drop policy if exists attendance_logs_admin_insert on public.attendance_logs;
drop policy if exists attendance_logs_admin_update on public.attendance_logs;
drop policy if exists attendance_logs_admin_delete on public.attendance_logs;
drop policy if exists attendance_logs_member_read_own on public.attendance_logs;
drop policy if exists attendance_logs_trainer_read_assigned on public.attendance_logs;
drop policy if exists attendance_logs_admin_all on public.attendance_logs;

create policy attendance_logs_member_read_own
on public.attendance_logs
for select
to authenticated
using (
  gym_id = app.current_gym_id()
  and user_id = auth.uid()
);

create policy attendance_logs_trainer_read_assigned
on public.attendance_logs
for select
to authenticated
using (
  gym_id = app.current_gym_id()
  and app.trainer_has_member(user_id)
);

create policy attendance_logs_admin_all
on public.attendance_logs
for all
to authenticated
using (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
)
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and app.user_belongs_to_gym(user_id, gym_id)
  and (created_by is null or app.user_belongs_to_gym(created_by, gym_id))
);

commit;
