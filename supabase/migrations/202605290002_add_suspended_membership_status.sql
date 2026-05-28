-- Phase 3.1 - Add suspended membership status before membership plan functions reference it.

alter type public.membership_status add value if not exists 'suspended';
