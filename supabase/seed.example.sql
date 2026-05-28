-- Example seed statements for local development only.
-- Replace UUID values with real IDs from auth.users after creating users in
-- Supabase Auth. Do not run this file in production as-is.

begin;

insert into public.users (id, gym_id, fullname, email, phone, role)
values
  ('00000000-0000-0000-0000-000000000001', (select id from public.gyms where slug = 'default-gym'), 'Gym Admin', 'admin@example.com', '+256700000001', 'admin'),
  ('00000000-0000-0000-0000-000000000002', (select id from public.gyms where slug = 'default-gym'), 'Gym Trainer', 'trainer@example.com', '+256700000002', 'trainer'),
  ('00000000-0000-0000-0000-000000000003', (select id from public.gyms where slug = 'default-gym'), 'Gym Member', 'member@example.com', '+256700000003', 'member')
on conflict (id) do nothing;

update public.users
set assigned_trainer = '00000000-0000-0000-0000-000000000002'
where id = '00000000-0000-0000-0000-000000000003';

insert into public.memberships (gym_id, user_id, type, start_date, end_date, status)
values (
  (select id from public.gyms where slug = 'default-gym'),
  '00000000-0000-0000-0000-000000000003',
  'Monthly',
  current_date,
  current_date + interval '30 days',
  'active'
);

insert into public.attendance_qr_tokens (gym_id, token, validity_type, issued_at, expires_at, generated_by, active)
values (
  (select id from public.gyms where slug = 'default-gym'),
  'replace-with-a-cryptographically-random-token',
  'weekly',
  now(),
  now() + interval '7 days',
  '00000000-0000-0000-0000-000000000001',
  true
);

insert into public.workout_programs (gym_id, title, description, created_by)
values (
  (select id from public.gyms where slug = 'default-gym'),
  'Starter Strength',
  'Full-body beginner routine for three weekly sessions.',
  '00000000-0000-0000-0000-000000000002'
);

commit;
