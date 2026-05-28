begin;

create or replace function pg_temp.pass(test_name text)
returns void
language plpgsql
as $$
begin
  raise notice 'PASS - %', test_name;
end;
$$;

create or replace function pg_temp.expect_eq(test_name text, actual bigint, expected bigint)
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

create or replace function pg_temp.expect_null(test_name text, actual uuid)
returns void
language plpgsql
as $$
begin
  if actual is not null then
    raise exception 'FAIL - %: expected null, got %', test_name, actual;
  end if;

  perform pg_temp.pass(test_name);
end;
$$;

create or replace function pg_temp.expect_error(test_name text, statement text)
returns void
language plpgsql
as $$
begin
  execute statement;
  raise exception 'FAIL - %: expected statement to be blocked', test_name;
exception
  when others then
    if sqlerrm like 'FAIL - %' then
      raise;
    end if;

    perform pg_temp.pass(test_name);
end;
$$;

select pg_temp.expect_eq(
  'all tenant tables have RLS enabled',
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'gyms',
        'users',
        'membership_plans',
        'memberships',
        'attendance_qr_tokens',
        'attendance_logs',
        'payments',
        'workout_programs',
        'user_workouts',
        'progress_logs'
      )
      and not c.relrowsecurity
  ),
  0
);

insert into public.gyms (id, name, slug, active)
values
  ('10000000-0000-0000-0000-000000000001', 'Phase 2 Gym A', 'phase2-gym-a', true),
  ('10000000-0000-0000-0000-000000000002', 'Phase 2 Gym B', 'phase2-gym-b', true)
on conflict (id) do nothing;

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
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase2-admin-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase2-trainer-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase2-member-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase2-unassigned-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase2-disabled-a@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase2-admin-b@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase2-trainer-b@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase2-member-b@example.test', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.users (id, gym_id, fullname, email, role, assigned_trainer, account_status)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Phase 2 Admin A', 'phase2-admin-a@example.test', 'admin', null, 'active'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Phase 2 Trainer A', 'phase2-trainer-a@example.test', 'trainer', null, 'active'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Phase 2 Member A', 'phase2-member-a@example.test', 'member', '20000000-0000-0000-0000-000000000002', 'active'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Phase 2 Unassigned A', 'phase2-unassigned-a@example.test', 'member', null, 'active'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Phase 2 Disabled A', 'phase2-disabled-a@example.test', 'member', null, 'disabled'),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'Phase 2 Admin B', 'phase2-admin-b@example.test', 'admin', null, 'active'),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000002', 'Phase 2 Trainer B', 'phase2-trainer-b@example.test', 'trainer', null, 'active'),
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002', 'Phase 2 Member B', 'phase2-member-b@example.test', 'member', '20000000-0000-0000-0000-000000000007', 'active');

insert into public.memberships (id, gym_id, user_id, type, start_date, end_date, status)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Monthly', current_date - 1, current_date + 30, 'active'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'Monthly', current_date - 1, current_date + 30, 'active'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000008', 'Monthly', current_date - 1, current_date + 30, 'active');

insert into public.attendance_qr_tokens (id, gym_id, token, validity_type, issued_at, expires_at, generated_by, active)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'phase2-token-gym-a-00000001', 'monthly', now() - interval '1 hour', now() + interval '30 days', '20000000-0000-0000-0000-000000000001', true),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'phase2-token-gym-b-00000002', 'monthly', now() - interval '1 hour', now() + interval '30 days', '20000000-0000-0000-0000-000000000006', true);

insert into public.attendance_logs (id, gym_id, user_id, qr_token_id, status)
values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 'success'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', 'success'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000002', 'success');

insert into public.workout_programs (id, gym_id, title, description, created_by)
values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Phase 2 Workout A', null, '20000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Phase 2 Workout B', null, '20000000-0000-0000-0000-000000000007');

insert into public.user_workouts (id, gym_id, user_id, workout_id)
values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000002');

insert into public.payments (id, gym_id, user_id, amount, method)
values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 100, 'cash'),
  ('80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000008', 100, 'cash');

insert into public.progress_logs (id, gym_id, user_id, weight, notes)
values
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 80, 'Gym A'),
  ('90000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000008', 80, 'Gym B');

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_eq('member can read own profile only', (select count(*)::bigint from public.users), 1);
select pg_temp.expect_eq('member cannot read other same-gym member', (select count(*)::bigint from public.users where id = '20000000-0000-0000-0000-000000000004'), 0);
select pg_temp.expect_eq('member cannot read other gym member', (select count(*)::bigint from public.users where id = '20000000-0000-0000-0000-000000000008'), 0);
select pg_temp.expect_eq('member sees only own memberships', (select count(*)::bigint from public.memberships), 1);
select pg_temp.expect_eq('member sees only own dashboard attendance rows', (select count(*)::bigint from public.attendance_logs), 1);
select pg_temp.expect_error('member cannot escalate privileges', $$update public.users set role = 'admin' where id = '20000000-0000-0000-0000-000000000003'$$);

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_eq('trainer can read assigned member only', (select count(*)::bigint from public.users where role = 'member'), 1);
select pg_temp.expect_eq('trainer cannot read unassigned same-gym member', (select count(*)::bigint from public.users where id = '20000000-0000-0000-0000-000000000004'), 0);
select pg_temp.expect_eq('trainer cannot read cross-gym assigned member', (select count(*)::bigint from public.users where id = '20000000-0000-0000-0000-000000000008'), 0);
select pg_temp.expect_eq('trainer dashboard aggregation cannot include unrelated attendance', (select count(*)::bigint from public.attendance_logs), 1);
select pg_temp.expect_error('trainer cannot assign cross-gym workout', $$insert into public.user_workouts (gym_id, user_id, workout_id) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000002')$$);

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_eq('admin sees all same-gym users including inactive', (select count(*)::bigint from public.users), 5);
select pg_temp.expect_eq('admin cannot see cross-gym users', (select count(*)::bigint from public.users where gym_id = '10000000-0000-0000-0000-000000000002'), 0);
select pg_temp.expect_eq('admin dashboard aggregation remains gym-scoped', (select count(*)::bigint from public.attendance_logs), 2);
select pg_temp.expect_eq('admin can read only current gym metadata', (select count(*)::bigint from public.gyms), 1);
select pg_temp.expect_error('admin cannot assign cross-gym trainer', $$update public.users set assigned_trainer = '20000000-0000-0000-0000-000000000007' where id = '20000000-0000-0000-0000-000000000003'$$);

reset role;
select pg_temp.expect_error('privileged writes cannot create cross-gym trainer assignment', $$insert into public.users (id, gym_id, fullname, email, role, assigned_trainer, account_status) values ('20000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000001', 'Invalid Assignment', 'invalid-assignment@example.test', 'member', '20000000-0000-0000-0000-000000000007', 'active')$$);
select pg_temp.expect_error('invalid role values are rejected', $$insert into public.users (id, gym_id, fullname, email, role, account_status) values ('20000000-0000-0000-0000-000000000098', '10000000-0000-0000-0000-000000000001', 'Invalid Role', 'invalid-role@example.test', 'owner', 'active')$$);

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select pg_temp.expect_eq('disabled user can read only own profile for logout hydration', (select count(*)::bigint from public.users), 1);
select pg_temp.expect_eq('disabled user cannot read tenant memberships', (select count(*)::bigint from public.memberships), 0);
select pg_temp.expect_eq('disabled user cannot read tenant attendance', (select count(*)::bigint from public.attendance_logs), 0);
select pg_temp.expect_null('disabled user has no active current gym', app.current_gym_id());

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select pg_temp.expect_error('anonymous users cannot read profiles', $$select count(*) from public.users$$);
select pg_temp.expect_error('anonymous users cannot read gyms', $$select count(*) from public.gyms$$);

reset role;
rollback;
