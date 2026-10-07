alter table public.splendor_bots add column if not exists launch_claimed_at timestamptz;
alter table public.splendor_evaluations add column if not exists launch_claimed_at timestamptz;
alter table public.splendor_practice_sessions add column if not exists busy boolean not null default false;
