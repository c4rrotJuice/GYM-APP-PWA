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
  ('12000000-0000-0000-0000-000000000001', 'Finance Gym A', 'finance-gym-a', true),
  ('12000000-0000-0000-0000-000000000002', 'Finance Gym B', 'finance-gym-b', true);

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
  ('22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finance-admin-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('22000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finance-member-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('22000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finance-admin-b@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('22000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finance-member-b@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.users (id, gym_id, fullname, email, role, account_status)
values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Finance Admin A', 'finance-admin-a@example.test', 'admin', 'active'),
  ('22000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000001', 'Finance Member A', 'finance-member-a@example.test', 'member', 'active'),
  ('22000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-000000000002', 'Finance Admin B', 'finance-admin-b@example.test', 'admin', 'active'),
  ('22000000-0000-0000-0000-000000000004', '12000000-0000-0000-0000-000000000002', 'Finance Member B', 'finance-member-b@example.test', 'member', 'active');

insert into public.membership_plans (id, gym_id, name, duration_type, duration_days, price, active)
values
  ('32000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Finance Monthly A', 'monthly', 30, 100, true),
  ('32000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002', 'Finance Monthly B', 'monthly', 30, 100, true);

reset role;
select set_config('request.jwt.claim.sub', '22000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select public.record_membership_payment(
  '22000000-0000-0000-0000-000000000002',
  '32000000-0000-0000-0000-000000000001',
  100,
  'cash',
  'CASH-001',
  'completed',
  'manual cash payment',
  '2026-05-29T09:00:00Z',
  null,
  null,
  '{}'::jsonb,
  '2026-05-29'
);

select pg_temp.expect_count('completed payment activates membership', (
  select count(*)::bigint
  from public.memberships
  where user_id = '22000000-0000-0000-0000-000000000002'
    and status = 'active'
    and payment_id is not null
), 1);
select pg_temp.expect_count('payment links back to membership', (
  select count(*)::bigint
  from public.payments p
  join public.memberships m on m.id = p.membership_id and m.payment_id = p.id
  where p.reference = 'CASH-001'
), 1);

select public.record_membership_payment(
  '22000000-0000-0000-0000-000000000002',
  '32000000-0000-0000-0000-000000000001',
  75,
  'mobile_money',
  'MTN-PENDING-001',
  'pending',
  'awaiting provider confirmation',
  null,
  'mtn_momo',
  'mtn-ref-001',
  '{"provider":"mtn_momo","collection_request_id":"mtn-ref-001"}'::jsonb,
  '2026-05-29'
);

select pg_temp.expect_count('pending payment does not create membership', (
  select count(*)::bigint
  from public.memberships
  where user_id = '22000000-0000-0000-0000-000000000002'
), 1);
select pg_temp.expect_eq('financial summary total revenue', (
  select total_revenue::text from public.financial_summary('2026-05-29')
), '100.00');
select pg_temp.expect_eq('financial summary monthly revenue', (
  select monthly_revenue::text from public.financial_summary('2026-05-29')
), '100.00');
select pg_temp.expect_eq('financial summary pending balance', (
  select pending_balances::text from public.financial_summary('2026-05-29')
), '75.00');
select pg_temp.expect_raises(
  'finalized payment amount is immutable',
  $statement$
    update public.payments
    set amount = 1
    where reference = 'CASH-001'
  $statement$
);

reset role;
select set_config('request.jwt.claim.sub', '22000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_count('member sees own payments only', (select count(*)::bigint from public.payments), 2);
select pg_temp.expect_raises(
  'member cannot view financial summary',
  $statement$ select * from public.financial_summary('2026-05-29') $statement$
);

reset role;
select set_config('request.jwt.claim.sub', '22000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select public.record_membership_payment(
  '22000000-0000-0000-0000-000000000004',
  '32000000-0000-0000-0000-000000000002',
  100,
  'cash',
  'CASH-B-001',
  'completed',
  null,
  '2026-05-29T10:00:00Z',
  null,
  null,
  '{}'::jsonb,
  '2026-05-29'
);

select pg_temp.expect_count('admin sees own tenant payments only', (select count(*)::bigint from public.payments), 1);
select pg_temp.expect_count('tenant isolation hides other gym payments', (
  select count(*)::bigint
  from public.payments
  where reference in ('CASH-001', 'MTN-PENDING-001')
), 0);

reset role;
rollback;
