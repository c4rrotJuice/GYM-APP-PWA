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

reset role;
select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_count('admin can see same-gym plans only', (select count(*)::bigint from public.membership_plans), 1);
select app.renew_membership_from_plan('21000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000001', null, '2026-05-29');
select pg_temp.expect_eq('new renewal starts today', (select start_date::text from public.memberships where user_id = '21000000-0000-0000-0000-000000000003'), '2026-05-29');
select app.renew_membership_from_plan('21000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000001', null, '2026-05-30');
select pg_temp.expect_count('pre-expiry renewal extends existing row', (select count(*)::bigint from public.memberships where user_id = '21000000-0000-0000-0000-000000000003'), 1);
select pg_temp.expect_eq('renewal count increments', (select renewal_count::text from public.memberships where user_id = '21000000-0000-0000-0000-000000000003'), '1');
select app.renew_membership_from_plan('21000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000001', null, '2026-07-01');
select pg_temp.expect_count('post-expiry renewal creates a new row', (select count(*)::bigint from public.memberships where user_id = '21000000-0000-0000-0000-000000000003'), 2);
select pg_temp.expect_count('stale active row is expired before post-expiry renewal', (select count(*)::bigint from public.memberships where user_id = '21000000-0000-0000-0000-000000000003' and status = 'expired'), 1);

reset role;
select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_count('trainer can view assigned member memberships', (select count(*)::bigint from public.memberships), 1);

reset role;
select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_count('member can view own memberships only', (select count(*)::bigint from public.memberships), 1);
select pg_temp.expect_count('member cannot see cross-gym plans through RLS', (select count(*)::bigint from public.membership_plans where gym_id = '11000000-0000-0000-0000-000000000002'), 0);

reset role;
rollback;
