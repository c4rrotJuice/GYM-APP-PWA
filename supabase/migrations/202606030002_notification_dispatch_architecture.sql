-- Notification dispatch queue foundation.
-- Creates manual queue storage only; scheduled dispatch jobs are intentionally out of scope.

begin;

create extension if not exists pgcrypto;

create table if not exists public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  type text not null check (length(trim(type)) > 0),
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists notification_queue_status_created_idx
  on public.notification_queue (status, created_at);

create index if not exists notification_queue_recipient_status_idx
  on public.notification_queue (recipient_user_id, status);

create or replace function app.notification_recipient_in_current_gym(target_user_id uuid)
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
      and u.gym_id = app.current_gym_id()
  )
$$;

alter table public.notification_queue enable row level security;

drop policy if exists notification_queue_select_scoped on public.notification_queue;
create policy notification_queue_select_scoped
on public.notification_queue
for select
to authenticated
using (
  recipient_user_id = auth.uid()
  or (
    app.user_is_admin()
    and app.notification_recipient_in_current_gym(recipient_user_id)
  )
);

drop policy if exists notification_queue_admin_insert on public.notification_queue;
create policy notification_queue_admin_insert
on public.notification_queue
for insert
to authenticated
with check (
  app.user_is_admin()
  and app.notification_recipient_in_current_gym(recipient_user_id)
);

drop policy if exists notification_queue_admin_update on public.notification_queue;
create policy notification_queue_admin_update
on public.notification_queue
for update
to authenticated
using (
  app.user_is_admin()
  and app.notification_recipient_in_current_gym(recipient_user_id)
)
with check (
  app.user_is_admin()
  and app.notification_recipient_in_current_gym(recipient_user_id)
);

drop policy if exists notification_queue_admin_delete on public.notification_queue;
create policy notification_queue_admin_delete
on public.notification_queue
for delete
to authenticated
using (
  app.user_is_admin()
  and app.notification_recipient_in_current_gym(recipient_user_id)
);

commit;
