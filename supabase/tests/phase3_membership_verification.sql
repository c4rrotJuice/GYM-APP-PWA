begin;

create or replace function pg_temp.pass(test_name text)
returns void
language plpgsql
as $$
begin
  raise notice 'PASS - %', test_name;
end;
$$;

create or replace function pg_temp.expect_eq(test_name text, actual text, expected text)
returns void
language plpgsql
as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL - %: expected %, got %', test_name, expected, actual;
  end if;

  perform pg_temp.pass(test_name);
end;
$$;

create or replace function pg_temp.expect_count(test_name text, actual bigint, expected bigint)
returns void
language plpgsql
as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL - %: expected %, got %', test_name, expected, actual;
  end if;

  perform pg_temp.pass(test_name);
end;
$$;

create or replace function pg_temp.expect_raises(test_name text, statement text)
returns void
language plpgsql
as $$
declare
  did_raise boolean := false;
begin
  begin
    execute statement;
  exception
    when others then
      did_raise := true;
  end;

  if not did_raise then
    raise exception 'FAIL - %: expected statement to raise', test_name;
  end if;

  perform pg_temp.pass(test_name);
end;
$$;

insert into public.gyms (id, name, slug, active)
values
  ('11000000-0000-0000-0000-000000000001', 'Phase 3 Gym A', 'phase3-gym-a', true),
  ('11000000-0000-0000-0000-000000000002', 'Phase 3 Gym B', 'phase3-gym-b', true);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase3-admin-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('21000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase3-trainer-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('21000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase3-member-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('21000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase3-admin-b@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('21000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase3-member-b@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.users (id, gym_id, fullname, email, role, assigned_trainer, account_status)
values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'Phase 3 Admin A', 'phase3-admin-a@example.test', 'admin', null, 'active'),
  ('21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 'Phase 3 Trainer A', 'phase3-trainer-a@example.test', 'trainer', null, 'active'),
  ('21000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', 'Phase 3 Member A', 'phase3-member-a@example.test', 'member', '21000000-0000-0000-0000-000000000002', 'active'),
  ('21000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000002', 'Phase 3 Admin B', 'phase3-admin-b@example.test', 'admin', null, 'active'),
  ('21000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000002', 'Phase 3 Member B', 'phase3-member-b@example.test', 'member', null, 'active');

insert into public.membership_plans (id, gym_id, name, duration_type, duration_days, price, active)
values
  ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'Weekly A', 'weekly', 7, 100, true),
  ('31000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', 'Weekly B', 'weekly', 7, 100, true);

select pg_temp.expect_eq('weekly end date calculation', app.calculate_membership_end_date('2026-05-29', 'weekly', 7)::text, '2026-06-05');
select pg_temp.expect_eq('expired status resolver', app.resolve_membership_status('active', '2026-05-01', '2026-05-28', '2026-05-29')::text, 'expired');
select pg_temp.expect_eq('suspended status resolver', app.resolve_membership_status('suspended', '2026-05-01', '2026-06-01', '2026-05-29')::text, 'suspended');
select pg_temp.expect_eq('pending status transitions when started', app.resolve_membership_status('pending', '2026-05-01', '2026-06-01', '2026-05-29')::text, 'active');

reset role;
select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_count('admin can see same-gym plans only', (select count(*)::bigint from public.membership_plans), 1);
select app.renew_membership_from_plan('21000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000001', null, '2026-05-29');
select pg_temp.expect_eq('new renewal starts today', (select start_date::text from public.memberships where user_id = '21000000-0000-0000-0000-000000000003'), '2026-05-29');
select app.renew_membership_from_plan('21000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000001', null, '2026-05-30');
select pg_temp.expect_count('pre-expiry renewal appends pending row', (select count(*)::bigint from public.memberships where user_id = '21000000-0000-0000-0000-000000000003'), 2);
select pg_temp.expect_count('only one stored active membership remains after append', (select count(*)::bigint from public.memberships where user_id = '21000000-0000-0000-0000-000000000003' and status = 'active'), 1);
select pg_temp.expect_eq('renewal appends from active expiry', (
  select start_date::text
  from public.memberships
  where user_id = '21000000-0000-0000-0000-000000000003'
    and status = 'pending'
), '2026-06-06');
select pg_temp.expect_raises(
  'overlapping active or pending memberships are rejected',
  $statement$
    insert into public.memberships (gym_id, user_id, membership_plan_id, type, start_date, end_date, status)
    values ('11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000001', 'Overlap', '2026-06-01', '2026-06-03', 'pending')
  $statement$
);
select app.renew_membership_from_plan('21000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000001', null, '2026-07-01');
select pg_temp.expect_count('post-expiry renewal creates a new row', (select count(*)::bigint from public.memberships where user_id = '21000000-0000-0000-0000-000000000003'), 3);
select pg_temp.expect_count('stale active and pending rows expire before post-expiry renewal', (select count(*)::bigint from public.memberships where user_id = '21000000-0000-0000-0000-000000000003' and status = 'expired'), 2);
select pg_temp.expect_count('post-expiry renewal links previous row', (
  select count(*)::bigint
  from public.memberships renewed
  join public.memberships previous on previous.id = renewed.renewed_from_membership_id
  where renewed.user_id = '21000000-0000-0000-0000-000000000003'
    and renewed.status = 'active'
    and previous.status = 'expired'
), 1);
select pg_temp.expect_count('membership history logs assignment renewals and expiries', (
  select count(*)::bigint
  from public.membership_history
  where user_id = '21000000-0000-0000-0000-000000000003'
), 5);

select app.suspend_membership(
  (select id from public.memberships where user_id = '21000000-0000-0000-0000-000000000003' and status = 'active'),
  'Manual verification'
);
select pg_temp.expect_count('suspension removes current active membership', (select count(*)::bigint from public.memberships where user_id = '21000000-0000-0000-0000-000000000003' and status = 'active'), 0);
select app.reactivate_membership(
  (select id from public.memberships where user_id = '21000000-0000-0000-0000-000000000003' and status = 'suspended'),
  '2026-07-02'
);
select pg_temp.expect_count('reactivation restores active membership inside date window', (select count(*)::bigint from public.memberships where user_id = '21000000-0000-0000-0000-000000000003' and status = 'active'), 1);
select pg_temp.expect_eq('active resolver returns reactivated membership', (
  select (app.resolve_active_membership('21000000-0000-0000-0000-000000000003', '2026-07-02')).status::text
), 'active');
select pg_temp.expect_count('expiring soon utility detects current membership', (
  select count(*)::bigint
  from app.memberships_expiring_soon('11000000-0000-0000-0000-000000000001', 7, '2026-07-02')
), 1);

reset role;
select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_count('trainer can view assigned member memberships', (select count(*)::bigint from public.memberships), 3);
select pg_temp.expect_count('trainer can view assigned member membership history', (select count(*)::bigint from public.membership_history), 7);

reset role;
select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_count('member can view own memberships only', (select count(*)::bigint from public.memberships), 3);
select pg_temp.expect_count('member can view own membership history only', (select count(*)::bigint from public.membership_history), 7);
select pg_temp.expect_count('member cannot see cross-gym plans through RLS', (select count(*)::bigint from public.membership_plans where gym_id = '11000000-0000-0000-0000-000000000002'), 0);
select pg_temp.expect_raises(
  'member cannot suspend memberships through operational RPC',
  $statement$
    select app.suspend_membership((select id from public.memberships limit 1), 'not allowed')
  $statement$
);
update public.memberships
set status = 'cancelled'
where id = (select id from public.memberships limit 1);
select pg_temp.expect_count(
  'member cannot directly alter memberships',
  (select count(*)::bigint from public.memberships where status = 'cancelled'),
  0
);

reset role;
rollback;
