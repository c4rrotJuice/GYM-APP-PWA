begin;

-- =====================================================
-- USERS
-- =====================================================

insert into public.users (
  id,
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
  email = excluded.email,
  role = excluded.role,
  assigned_trainer = excluded.assigned_trainer,
  account_status = excluded.account_status;

-- =====================================================
-- WORKOUT PROGRAMS (must exist before assignments)
-- =====================================================

insert into public.workout_programs (
  id,
  title,
  description,
  created_by
)
values
(
  gen_random_uuid(),
  'Beginner Conditioning',
  'Starter full-body routine focused on consistency and endurance.',
  'af06e254-c03e-4f2c-b212-60d99ae66d19'
),
(
  gen_random_uuid(),
  'Strength Foundation',
  'Compound lifts for progressive overload training.',
  'af06e254-c03e-4f2c-b212-60d99ae66d19'
)
on conflict do nothing;

-- =====================================================
-- MEMBERSHIPS
-- =====================================================

insert into public.memberships (
  user_id,
  type,
  start_date,
  end_date,
  status
)
values
(
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
  token,
  validity_type,
  issued_at,
  expires_at,
  generated_by,
  active
)
values
(
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
  user_id,
  workout_id,
  assigned_at
)
select
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
  user_id,
  weight,
  notes,
  created_at
)
values
(
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
  user_id,
  amount,
  method,
  reference,
  paid_at
)
values
(
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
  user_id,
  qr_token_id,
  scanned_at,
  status
)
select
  'c88e735d-e92d-484f-a826-e5ee1408ac18',
  t.id,
  now(),
  'success'
from public.attendance_qr_tokens t
where t.generated_by = '82120aa0-0327-422a-8973-dd0ee0d98d19'
limit 1
on conflict do nothing;

commit;
