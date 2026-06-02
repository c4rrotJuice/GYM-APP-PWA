-- Push subscription storage foundation.
-- Stores browser Push API endpoints only; notification sending is intentionally out of scope.

begin;

create extension if not exists pgcrypto;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null check (length(trim(endpoint)) > 0),
  p256dh text not null check (length(trim(p256dh)) > 0),
  auth text not null check (length(trim(auth)) > 0),
  created_at timestamptz not null default now(),
  active boolean not null default true,
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

create index if not exists push_subscriptions_active_user_idx
  on public.push_subscriptions (user_id, active);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
on public.push_subscriptions
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
on public.push_subscriptions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
on public.push_subscriptions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
on public.push_subscriptions
for delete
to authenticated
using (user_id = auth.uid());

commit;
