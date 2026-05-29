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
  ('12000000-0000-0000-0000-000000000001', 'Phase 3.4 Gym A', 'phase34-gym-a', true),
  ('12000000-0000-0000-0000-000000000002', 'Phase 3.4 Gym B', 'phase34-gym-b', true);

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
  ('22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase34-admin-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('22000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase34-trainer-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('22000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase34-member-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('22000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase34-member-suspended@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('22000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase34-admin-b@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.users (id, gym_id, fullname, email, role, assigned_trainer, account_status)
values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Phase 3.4 Admin A', 'phase34-admin-a@example.test', 'admin', null, 'active'),
  ('22000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000001', 'Phase 3.4 Trainer A', 'phase34-trainer-a@example.test', 'trainer', null, 'active'),
  ('22000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-000000000001', 'Phase 3.4 Member A', 'phase34-member-a@example.test', 'member', '22000000-0000-0000-0000-000000000002', 'active'),
  ('22000000-0000-0000-0000-000000000004', '12000000-0000-0000-0000-000000000001', 'Phase 3.4 Suspended Member', 'phase34-member-suspended@example.test', 'member', '22000000-0000-0000-0000-000000000002', 'active'),
  ('22000000-0000-0000-0000-000000000005', '12000000-0000-0000-0000-000000000002', 'Phase 3.4 Admin B', 'phase34-admin-b@example.test', 'admin', null, 'active');

insert into public.membership_plans (id, gym_id, name, duration_type, duration_days, price, active)
values
  ('32000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Weekly A', 'weekly', 7, 100, true);

insert into public.memberships (id, gym_id, user_id, membership_plan_id, type, start_date, end_date, status)
values
  ('42000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000001', 'Expired stale', '2026-05-01', '2026-05-20', 'active'),
  ('42000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000001', 'Pending current', '2026-05-21', '2026-06-02', 'pending'),
  ('42000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000004', '32000000-0000-0000-0000-000000000001', 'Suspended current', '2026-05-01', '2026-06-02', 'suspended');

reset role;
select set_config('request.jwt.claim.sub', '22000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select public.process_membership_expiry('2026-05-29', 7);
select pg_temp.expect_eq('stale active membership is materialized as expired', (select status::text from public.memberships where id = '42000000-0000-0000-0000-000000000001'), 'expired');
select pg_temp.expect_eq('current pending membership is materialized as active', (select status::text from public.memberships where id = '42000000-0000-0000-0000-000000000002'), 'active');
select pg_temp.expect_eq('suspended membership remains excluded from recalculation', (select status::text from public.memberships where id = '42000000-0000-0000-0000-000000000003'), 'suspended');

select pg_temp.expect_count('expiring soon query detects active renewal window', (
  select count(*)::bigint
  from public.memberships_expiring_soon(7, '2026-05-29')
), 1);

select pg_temp.expect_count('notification triggers are prepared without delivery implementation', (
  select count(*)::bigint
  from public.membership_notification_triggers
  where trigger_type in ('membership_expired', 'membership_expiring_soon')
), 2);

select pg_temp.expect_eq('attendance eligibility allows current active member', (
  select can_attend::text
  from public.can_attend_gym('22000000-0000-0000-0000-000000000003', '2026-05-29')
), 'true');
select pg_temp.expect_eq('attendance eligibility excludes suspended member', (
  select reason
  from public.can_attend_gym('22000000-0000-0000-0000-000000000004', '2026-05-29')
), 'membership_suspended');

select pg_temp.expect_count('operational summary reports attendance-ready members', (
  select attendance_ready_count
  from public.membership_expiry_operational_summary(7, '2026-05-29')
), 1);

insert into public.attendance_qr_tokens (id, gym_id, token, validity_type, issued_at, expires_at, generated_by, active)
values (
  '52000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'phase34-valid-attendance-token',
  'weekly',
  '2026-05-29T00:00:00Z',
  '2026-06-05T00:00:00Z',
  '22000000-0000-0000-0000-000000000001',
  true
);

reset role;
select set_config('request.jwt.claim.sub', '22000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_eq('member can evaluate own attendance readiness', (
  select can_attend::text
  from public.can_attend_gym('22000000-0000-0000-0000-000000000003', '2026-05-29')
), 'true');
select pg_temp.expect_eq('attendance policy helper depends on expiry engine eligibility', (
  select app.can_log_attendance('22000000-0000-0000-0000-000000000003', '52000000-0000-0000-0000-000000000001')::text
), 'true');
select pg_temp.expect_raises(
  'member cannot run expiry processing',
  $statement$
    select public.process_membership_expiry('2026-05-29', 7)
  $statement$
);

reset role;
select set_config('request.jwt.claim.sub', '22000000-0000-0000-0000-000000000005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_count('cross-gym admin cannot see gym A notification triggers', (
  select count(*)::bigint
  from public.membership_notification_triggers
), 0);
select pg_temp.expect_eq('cross-gym admin receives non-attending eligibility without leaking membership data', (
  select can_attend::text || ':' || reason || ':' || coalesce(membership_id::text, 'none')
  from public.can_attend_gym('22000000-0000-0000-0000-000000000003', '2026-05-29')
), 'false:member_not_active:none');

reset role;
rollback;
