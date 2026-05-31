-- Allow active members to record their own QR attendance after server-side
-- token and membership eligibility checks pass.

begin;

drop policy if exists attendance_logs_member_insert_valid_scan on public.attendance_logs;
create policy attendance_logs_member_insert_valid_scan
on public.attendance_logs
for insert
to authenticated
with check (
  gym_id = app.current_gym_id()
  and user_id = auth.uid()
  and created_by = auth.uid()
  and source = 'qr'
  and app.can_log_attendance(user_id, qr_token_id)
);

commit;
