begin;

-- =====================================================
-- USERS
-- =====================================================

insert into public.users (
  id,
  gym_id,
  fullname,
  email,
  phone,
  role,
  assigned_trainer,
  account_status,
  created_at
)
values
(
  '82120aa0-0327-422a-8973-dd0ee0d98d19',
  (select id from public.gyms where slug = 'default-gym'),
  'Enoch Admin',
  'enoch.freelance@gmail.com',
  null,
  'admin',
  null,
  'active',
  now()
),
(
  'af06e254-c03e-4f2c-b212-60d99ae66d19',
  (select id from public.gyms where slug = 'default-gym'),
  'The Pages Trainer',
  'thepages.ug@gmail.com',
  null,
  'trainer',
  null,
  'active',
  now()
),
(
  'c88e735d-e92d-484f-a826-e5ee1408ac18',
  (select id from public.gyms where slug = 'default-gym'),
  'Milley Member',
  'milley.kk@gmail.com',
  null,
  'member',
  'af06e254-c03e-4f2c-b212-60d99ae66d19',
  'active',
  now()
)
on conflict (id) do update
set
  fullname = excluded.fullname,
  gym_id = excluded.gym_id,
  email = excluded.email,
  role = excluded.role,
  assigned_trainer = excluded.assigned_trainer,
  account_status = excluded.account_status;

-- =====================================================
-- WORKOUT PROGRAMS (must exist before assignments)
-- =====================================================

insert into public.workout_programs (
  id,
  gym_id,
  title,
  description,
  created_by
)
values
(
  gen_random_uuid(),
  (select id from public.gyms where slug = 'default-gym'),
  'Beginner Conditioning',
  'Starter full-body routine focused on consistency and endurance.',
  'af06e254-c03e-4f2c-b212-60d99ae66d19'
),
(
  gen_random_uuid(),
  (select id from public.gyms where slug = 'default-gym'),
  'Strength Foundation',
  'Compound lifts for progressive overload training.',
  'af06e254-c03e-4f2c-b212-60d99ae66d19'
)
on conflict do nothing;

-- =====================================================
-- MEMBERSHIPS
-- =====================================================

insert into public.memberships (
  gym_id,
  user_id,
  type,
  start_date,
  end_date,
  status
)
values
(
  (select id from public.gyms where slug = 'default-gym'),
  'c88e735d-e92d-484f-a826-e5ee1408ac18',
  'Monthly',
  current_date,
  current_date + interval '30 days',
  'active'
)
on conflict do nothing;

-- =====================================================
-- QR TOKEN
-- =====================================================

insert into public.attendance_qr_tokens (
  gym_id,
  token,
  validity_type,
  issued_at,
  expires_at,
  generated_by,
  active
)
values
(
  (select id from public.gyms where slug = 'default-gym'),
  encode(gen_random_bytes(32), 'hex'),
  'monthly',
  now(),
  now() + interval '30 days',
  '82120aa0-0327-422a-8973-dd0ee0d98d19',
  true
)
on conflict do nothing;

-- =====================================================
-- USER WORKOUT ASSIGNMENT (safe lookup)
-- =====================================================

insert into public.user_workouts (
  gym_id,
  user_id,
  workout_id,
  assigned_at
)
select
  wp.gym_id,
  'c88e735d-e92d-484f-a826-e5ee1408ac18',
  wp.id,
  now()
from public.workout_programs wp
where wp.title = 'Beginner Conditioning'
limit 1
on conflict do nothing;

-- =====================================================
-- PROGRESS LOG
-- =====================================================

insert into public.progress_logs (
  gym_id,
  user_id,
  weight,
  notes,
  created_at
)
values
(
  (select id from public.gyms where slug = 'default-gym'),
  'c88e735d-e92d-484f-a826-e5ee1408ac18',
  72.5,
  'Initial onboarding assessment completed.',
  now()
)
on conflict do nothing;

-- =====================================================
-- PAYMENTS (FIXED ENUM CONSTRAINT)
-- =====================================================

insert into public.payments (
  gym_id,
  user_id,
  amount,
  method,
  reference,
  paid_at
)
values
(
  (select id from public.gyms where slug = 'default-gym'),
  'c88e735d-e92d-484f-a826-e5ee1408ac18',
  120000,
  'mobile_money',
  'GYM-SEED-001',
  now()
)
on conflict do nothing;

-- =====================================================
-- ATTENDANCE LOG
-- =====================================================

insert into public.attendance_logs (
  gym_id,
  user_id,
  qr_token_id,
  scanned_at,
  status
)
select
  t.gym_id,
  'c88e735d-e92d-484f-a826-e5ee1408ac18',
  t.id,
  now(),
  'success'
from public.attendance_qr_tokens t
where t.generated_by = '82120aa0-0327-422a-8973-dd0ee0d98d19'
limit 1
on conflict do nothing;

commit;
