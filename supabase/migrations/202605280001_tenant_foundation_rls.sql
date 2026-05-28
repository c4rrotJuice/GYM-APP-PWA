-- Gym Management PWA - tenant foundation and SaaS-safe RLS refactor.
-- Apply after 202605270001_initial_schema_rls.sql.

begin;

create extension if not exists pgcrypto;

create table if not exists public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  branding_config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug)
);

insert into public.gyms (name, slug, branding_config, active)
values ('Default Gym', 'default-gym', '{}'::jsonb, true)
on conflict (slug) do update
set
  name = excluded.name,
  active = true,
  updated_at = now();

alter table public.users add column if not exists gym_id uuid references public.gyms(id) on delete restrict;
alter table public.memberships add column if not exists gym_id uuid references public.gyms(id) on delete restrict;
alter table public.attendance_qr_tokens add column if not exists gym_id uuid references public.gyms(id) on delete restrict;
alter table public.attendance_logs add column if not exists gym_id uuid references public.gyms(id) on delete restrict;
alter table public.payments add column if not exists gym_id uuid references public.gyms(id) on delete restrict;
alter table public.workout_programs add column if not exists gym_id uuid references public.gyms(id) on delete restrict;
alter table public.user_workouts add column if not exists gym_id uuid references public.gyms(id) on delete restrict;
alter table public.progress_logs add column if not exists gym_id uuid references public.gyms(id) on delete restrict;

with default_gym as (
  select id from public.gyms where slug = 'default-gym'
)
update public.users u
set gym_id = default_gym.id
from default_gym
where u.gym_id is null;

update public.memberships m
set gym_id = coalesce(
  (select u.gym_id from public.users u where u.id = m.user_id),
  (select g.id from public.gyms g where g.slug = 'default-gym')
)
where m.gym_id is null;

update public.attendance_qr_tokens t
set gym_id = coalesce(
  (select u.gym_id from public.users u where u.id = t.generated_by),
  (select g.id from public.gyms g where g.slug = 'default-gym')
)
where t.gym_id is null;

update public.attendance_logs l
set gym_id = coalesce(
  (select u.gym_id from public.users u where u.id = l.user_id),
  (select t.gym_id from public.attendance_qr_tokens t where t.id = l.qr_token_id),
  (select g.id from public.gyms g where g.slug = 'default-gym')
)
where l.gym_id is null;

update public.payments p
set gym_id = coalesce(
  (select u.gym_id from public.users u where u.id = p.user_id),
  (select g.id from public.gyms g where g.slug = 'default-gym')
)
where p.gym_id is null;

update public.workout_programs wp
set gym_id = coalesce(
  (select u.gym_id from public.users u where u.id = wp.created_by),
  (select g.id from public.gyms g where g.slug = 'default-gym')
)
where wp.gym_id is null;

update public.user_workouts uw
set gym_id = coalesce(
  (select u.gym_id from public.users u where u.id = uw.user_id),
  (select wp.gym_id from public.workout_programs wp where wp.id = uw.workout_id),
  (select g.id from public.gyms g where g.slug = 'default-gym')
)
where uw.gym_id is null;

update public.progress_logs pl
set gym_id = coalesce(
  (select u.gym_id from public.users u where u.id = pl.user_id),
  (select g.id from public.gyms g where g.slug = 'default-gym')
)
where pl.gym_id is null;

alter table public.users alter column gym_id set not null;
alter table public.memberships alter column gym_id set not null;
alter table public.attendance_qr_tokens alter column gym_id set not null;
alter table public.attendance_logs alter column gym_id set not null;
alter table public.payments alter column gym_id set not null;
alter table public.workout_programs alter column gym_id set not null;
alter table public.user_workouts alter column gym_id set not null;
alter table public.progress_logs alter column gym_id set not null;

drop trigger if exists set_gyms_updated_at on public.gyms;
create trigger set_gyms_updated_at
before update on public.gyms
for each row execute function public.set_updated_at();

create index if not exists gyms_active_idx on public.gyms (active);
create index if not exists users_gym_id_idx on public.users (gym_id);
create index if not exists users_gym_role_idx on public.users (gym_id, role);
create index if not exists users_gym_status_idx on public.users (gym_id, account_status);
create index if not exists users_gym_assigned_trainer_idx on public.users (gym_id, assigned_trainer);
create index if not exists memberships_gym_id_idx on public.memberships (gym_id);
create index if not exists attendance_qr_tokens_gym_id_idx on public.attendance_qr_tokens (gym_id);
create index if not exists attendance_logs_gym_id_idx on public.attendance_logs (gym_id);
create index if not exists payments_gym_id_idx on public.payments (gym_id);
create index if not exists workout_programs_gym_id_idx on public.workout_programs (gym_id);
create index if not exists user_workouts_gym_id_idx on public.user_workouts (gym_id);
create index if not exists progress_logs_gym_id_idx on public.progress_logs (gym_id);

create or replace function app.current_gym_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.gym_id
  from public.users u
  join public.gyms g on g.id = u.gym_id
  where u.id = auth.uid()
    and u.account_status = 'active'
    and g.active = true
$$;

create or replace function app.default_gym_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select g.id
  from public.gyms g
  where g.slug = 'default-gym'
    and g.active = true
$$;

create or replace function app.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.users u
  join public.gyms g on g.id = u.gym_id
  where u.id = auth.uid()
    and u.account_status = 'active'
    and g.active = true
$$;

create or replace function app.is_same_gym(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(target_gym_id = app.current_gym_id(), false)
$$;

create or replace function app.user_belongs_to_gym(user_id uuid, target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = user_id
      and u.gym_id = target_gym_id
  )
$$;

create or replace function app.workout_belongs_to_gym(program_id uuid, target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workout_programs wp
    where wp.id = program_id
      and wp.gym_id = target_gym_id
  )
$$;

create or replace function app.active_trainer_in_gym(trainer_id uuid, target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = trainer_id
      and u.gym_id = target_gym_id
      and u.role = 'trainer'
      and u.account_status = 'active'
  )
$$;

create or replace function app.user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app.current_user_role() = 'admin', false)
$$;

create or replace function app.user_is_trainer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app.current_user_role() = 'trainer', false)
$$;

create or replace function app.user_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app.current_user_role() = 'member', false)
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select app.user_is_admin() $$;

create or replace function app.is_trainer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select app.user_is_trainer() $$;

create or replace function app.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select app.user_is_member() $$;

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
      and u.gym_id = app.current_gym_id()
      and u.role = 'member'
      and u.account_status = 'active'
      and u.assigned_trainer = auth.uid()
      and app.user_is_trainer()
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
      and m.gym_id = app.current_gym_id()
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
      and uw.gym_id = app.current_gym_id()
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
        and wp.gym_id = app.current_gym_id()
        and wp.created_by = auth.uid()
    )
$$;

create or replace function app.enforce_user_update_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.gym_id is distinct from old.gym_id then
    raise exception 'user gym_id cannot be changed';
  end if;

  if new.assigned_trainer is not null and not exists (
    select 1
    from public.users trainer
    where trainer.id = new.assigned_trainer
      and trainer.gym_id = new.gym_id
      and trainer.role = 'trainer'
      and trainer.account_status = 'active'
  ) then
    raise exception 'assigned trainer must be an active trainer in the same gym';
  end if;

  if app.user_is_admin() then
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

  if tg_table_name in ('memberships', 'payments', 'progress_logs') then
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

drop trigger if exists enforce_user_update_security on public.users;
create trigger enforce_user_update_security
before update on public.users
for each row execute function app.enforce_user_update_security();

drop trigger if exists enforce_memberships_tenant_integrity on public.memberships;
create trigger enforce_memberships_tenant_integrity
before insert or update on public.memberships
for each row execute function app.enforce_tenant_row_integrity();

drop trigger if exists enforce_attendance_qr_tokens_tenant_integrity on public.attendance_qr_tokens;
create trigger enforce_attendance_qr_tokens_tenant_integrity
before insert or update on public.attendance_qr_tokens
for each row execute function app.enforce_tenant_row_integrity();

drop trigger if exists enforce_attendance_logs_tenant_integrity on public.attendance_logs;
create trigger enforce_attendance_logs_tenant_integrity
before insert or update on public.attendance_logs
for each row execute function app.enforce_tenant_row_integrity();

drop trigger if exists enforce_payments_tenant_integrity on public.payments;
create trigger enforce_payments_tenant_integrity
before insert or update on public.payments
for each row execute function app.enforce_tenant_row_integrity();

drop trigger if exists enforce_workout_programs_tenant_integrity on public.workout_programs;
create trigger enforce_workout_programs_tenant_integrity
before insert or update on public.workout_programs
for each row execute function app.enforce_tenant_row_integrity();

drop trigger if exists enforce_user_workouts_tenant_integrity on public.user_workouts;
create trigger enforce_user_workouts_tenant_integrity
before insert or update on public.user_workouts
for each row execute function app.enforce_tenant_row_integrity();

drop trigger if exists enforce_progress_logs_tenant_integrity on public.progress_logs;
create trigger enforce_progress_logs_tenant_integrity
before insert or update on public.progress_logs
for each row execute function app.enforce_tenant_row_integrity();

alter table public.gyms enable row level security;

revoke all on table public.gyms from anon;
grant select, update on table public.gyms to authenticated;

drop policy if exists gyms_select_scoped on public.gyms;
create policy gyms_select_scoped
on public.gyms
for select
to authenticated
using (id = app.current_gym_id());
  or id = app.default_gym_id()

drop policy if exists gyms_admin_update_scoped on public.gyms;
create policy gyms_admin_update_scoped
on public.gyms
for update
to authenticated
using (app.user_is_admin() and id = app.current_gym_id())
with check (app.user_is_admin() and id = app.current_gym_id());

drop policy if exists users_select_scoped on public.users;
create policy users_select_scoped
on public.users
for select
to authenticated
using (
  gym_id = app.current_gym_id()
  and (
    id = auth.uid()
    or app.user_is_admin()
    or app.trainer_has_member(id)
  )
);

drop policy if exists users_admin_insert on public.users;
create policy users_admin_insert
on public.users
for insert
to authenticated
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and (
    assigned_trainer is null
    or app.active_trainer_in_gym(assigned_trainer, gym_id)
  )
);

drop policy if exists users_self_bootstrap_insert on public.users;
create policy users_self_bootstrap_insert
on public.users
for insert
to authenticated
with check (
  id = auth.uid()
  and gym_id = app.default_gym_id()
  and role = 'member'
  and assigned_trainer is null
  and account_status = 'active'
);

drop policy if exists users_update_scoped on public.users;
create policy users_update_scoped
on public.users
for update
to authenticated
using (
  gym_id = app.current_gym_id()
  and (id = auth.uid() or app.user_is_admin())
)
with check (
  gym_id = app.current_gym_id()
  and (
    app.user_is_admin()
    or (
      id = auth.uid()
      and role = app.current_user_role()
      and account_status = 'active'
    )
  )
);

drop policy if exists users_admin_delete on public.users;
create policy users_admin_delete
on public.users
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
);

drop policy if exists memberships_admin_delete on public.memberships;
create policy memberships_admin_delete
on public.memberships
for delete
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id());

drop policy if exists attendance_qr_tokens_admin_all on public.attendance_qr_tokens;
create policy attendance_qr_tokens_admin_all
on public.attendance_qr_tokens
for all
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id())
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and generated_by = auth.uid()
);

drop policy if exists attendance_logs_select_scoped on public.attendance_logs;
create policy attendance_logs_select_scoped
on public.attendance_logs
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

drop policy if exists attendance_logs_member_insert_valid_scan on public.attendance_logs;
create policy attendance_logs_member_insert_valid_scan
on public.attendance_logs
for insert
to authenticated
with check (
  gym_id = app.current_gym_id()
  and status = 'success'
  and app.can_log_attendance(user_id, qr_token_id)
);

drop policy if exists attendance_logs_admin_insert on public.attendance_logs;
create policy attendance_logs_admin_insert
on public.attendance_logs
for insert
to authenticated
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and app.user_belongs_to_gym(user_id, gym_id)
);

drop policy if exists attendance_logs_admin_update on public.attendance_logs;
create policy attendance_logs_admin_update
on public.attendance_logs
for update
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id())
with check (
  app.user_is_admin()
  and gym_id = app.current_gym_id()
  and app.user_belongs_to_gym(user_id, gym_id)
);

drop policy if exists attendance_logs_admin_delete on public.attendance_logs;
create policy attendance_logs_admin_delete
on public.attendance_logs
for delete
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id());

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
    or app.trainer_has_member(user_id)
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
using (app.user_is_admin() and gym_id = app.current_gym_id());

drop policy if exists workout_programs_select_scoped on public.workout_programs;
create policy workout_programs_select_scoped
on public.workout_programs
for select
to authenticated
using (
  gym_id = app.current_gym_id()
  and (
    app.user_is_admin()
    or created_by = auth.uid()
    or app.member_has_workout(auth.uid(), id)
  )
);

drop policy if exists workout_programs_trainer_admin_insert on public.workout_programs;
create policy workout_programs_trainer_admin_insert
on public.workout_programs
for insert
to authenticated
with check (
  gym_id = app.current_gym_id()
  and (
    app.user_is_admin()
    or (app.user_is_trainer() and created_by = auth.uid())
  )
);

drop policy if exists workout_programs_trainer_admin_update on public.workout_programs;
create policy workout_programs_trainer_admin_update
on public.workout_programs
for update
to authenticated
using (
  gym_id = app.current_gym_id()
  and (app.user_is_admin() or (app.user_is_trainer() and created_by = auth.uid()))
)
with check (
  gym_id = app.current_gym_id()
  and (app.user_is_admin() or (app.user_is_trainer() and created_by = auth.uid()))
);

drop policy if exists workout_programs_trainer_admin_delete on public.workout_programs;
create policy workout_programs_trainer_admin_delete
on public.workout_programs
for delete
to authenticated
using (
  gym_id = app.current_gym_id()
  and (app.user_is_admin() or (app.user_is_trainer() and created_by = auth.uid()))
);

drop policy if exists user_workouts_select_scoped on public.user_workouts;
create policy user_workouts_select_scoped
on public.user_workouts
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

drop policy if exists user_workouts_trainer_admin_insert on public.user_workouts;
create policy user_workouts_trainer_admin_insert
on public.user_workouts
for insert
to authenticated
with check (
  gym_id = app.current_gym_id()
  and (
    app.user_is_admin()
    or app.trainer_can_assign_workout(user_id, workout_id)
  )
);

drop policy if exists user_workouts_trainer_admin_update on public.user_workouts;
create policy user_workouts_trainer_admin_update
on public.user_workouts
for update
to authenticated
using (
  gym_id = app.current_gym_id()
  and (app.user_is_admin() or app.trainer_has_member(user_id))
)
with check (
  gym_id = app.current_gym_id()
  and (
    app.user_is_admin()
    or app.trainer_can_assign_workout(user_id, workout_id)
  )
);

drop policy if exists user_workouts_trainer_admin_delete on public.user_workouts;
create policy user_workouts_trainer_admin_delete
on public.user_workouts
for delete
to authenticated
using (
  gym_id = app.current_gym_id()
  and (app.user_is_admin() or app.trainer_has_member(user_id))
);

drop policy if exists progress_logs_select_scoped on public.progress_logs;
create policy progress_logs_select_scoped
on public.progress_logs
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

drop policy if exists progress_logs_member_trainer_admin_insert on public.progress_logs;
create policy progress_logs_member_trainer_admin_insert
on public.progress_logs
for insert
to authenticated
with check (
  gym_id = app.current_gym_id()
  and (
    user_id = auth.uid()
    or app.user_is_admin()
    or app.trainer_has_member(user_id)
  )
);

drop policy if exists progress_logs_member_trainer_admin_update on public.progress_logs;
create policy progress_logs_member_trainer_admin_update
on public.progress_logs
for update
to authenticated
using (
  gym_id = app.current_gym_id()
  and (
    user_id = auth.uid()
    or app.user_is_admin()
    or app.trainer_has_member(user_id)
  )
)
with check (
  gym_id = app.current_gym_id()
  and (
    user_id = auth.uid()
    or app.user_is_admin()
    or app.trainer_has_member(user_id)
  )
);

drop policy if exists progress_logs_admin_delete on public.progress_logs;
create policy progress_logs_admin_delete
on public.progress_logs
for delete
to authenticated
using (app.user_is_admin() and gym_id = app.current_gym_id());

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

commit;
