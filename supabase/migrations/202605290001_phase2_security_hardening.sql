-- Phase 2 production hardening.
-- Tightens tenant visibility and makes disabled-account session restores explicit.

begin;

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

  if tg_op = 'INSERT' then
    return new;
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

drop trigger if exists enforce_user_update_security on public.users;
create trigger enforce_user_update_security
before insert or update on public.users
for each row execute function app.enforce_user_update_security();

drop policy if exists gyms_select_scoped on public.gyms;
create policy gyms_select_scoped
on public.gyms
for select
to authenticated
using (id = app.current_gym_id());

drop policy if exists users_select_scoped on public.users;
create policy users_select_scoped
on public.users
for select
to authenticated
using (
  id = auth.uid()
  or (
    gym_id = app.current_gym_id()
    and (
      app.user_is_admin()
      or app.trainer_has_member(id)
    )
  )
);

create or replace function public.default_gym_id()
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select app.default_gym_id()
$$;

revoke all on function public.default_gym_id() from public;
grant execute on function public.default_gym_id() to authenticated;
grant execute on function app.default_gym_id() to authenticated;

commit;
