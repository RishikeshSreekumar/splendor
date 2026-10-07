-- Isolated Splendor tables; existing project tables remain untouched.
create table if not exists public.splendor_bots (
 id uuid primary key, owner_id uuid references auth.users(id), name text not null check(length(name) between 1 and 50),
 source_hash text not null, project_hash text not null, artifact_key text not null unique,
 baseline boolean not null default false,
 qualification text not null default 'pending' check(qualification in ('pending','passed','failed')),
 qualification_error text, qualification_report_key text,
 created_at timestamptz not null default now(),
 unique(owner_id,name,project_hash)
);
create unique index if not exists splendor_baseline_versions on public.splendor_bots(name,project_hash) where baseline;
create index if not exists splendor_bots_owner on public.splendor_bots(owner_id,created_at desc);
create table if not exists public.splendor_evaluations (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 status text not null default 'queued' check(status in ('queued','running','completed','failed')),
 config jsonb not null, completed_games integer not null default 0, total_games integer not null,
 report_key text, error text, created_at timestamptz not null default now(), started_at timestamptz
);
create index if not exists splendor_evaluations_owner on public.splendor_evaluations(owner_id,created_at desc);
alter table public.splendor_bots enable row level security;
alter table public.splendor_evaluations enable row level security;
revoke all on public.splendor_bots,public.splendor_evaluations from anon,authenticated;
grant all on public.splendor_bots,public.splendor_evaluations to service_role;
-- Limits are checked transactionally; only the trusted API may reserve work.
create or replace function public.splendor_reserve_work(p_owner uuid,p_kind text,p_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if p_kind='bot' then
  if (select count(*) from splendor_bots where owner_id=p_owner and created_at>now()-interval '1 day') >= 20 then raise exception 'Daily submission limit reached'; end if;
  if (select count(*) from splendor_bots where owner_id=p_owner and qualification='pending') >= 2 then raise exception 'Wait for your pending qualification'; end if;
  insert into splendor_bots(id,owner_id,name,source_hash,project_hash,artifact_key) values(p_id,p_owner,p_payload->>'name',p_payload->>'source_hash',p_payload->>'project_hash',p_payload->>'artifact_key');
 elsif p_kind='evaluation' then
  if (select count(*) from splendor_evaluations where owner_id=p_owner and status in ('queued','running')) >= 2 then raise exception 'Wait for your active evaluations'; end if;
  if (select count(*) from splendor_evaluations where owner_id=p_owner and created_at>now()-interval '1 day') >= 20 then raise exception 'Daily evaluation limit reached'; end if;
  insert into splendor_evaluations(id,owner_id,config,total_games) values(p_id,p_owner,p_payload->'config',(p_payload->>'total_games')::integer);
 else raise exception 'Invalid work kind'; end if;
end $$;
revoke all on function public.splendor_reserve_work(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.splendor_reserve_work(uuid,text,uuid,jsonb) to service_role;
alter table public.splendor_bots add column if not exists sandbox_id text, add column if not exists started_at timestamptz;
alter table public.splendor_evaluations add column if not exists sandbox_id text;
create table if not exists public.splendor_practice_sessions (
 id uuid primary key,owner_id uuid not null references auth.users(id),state jsonb not null,clock jsonb not null,revision integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.splendor_practice_sessions enable row level security;
revoke all on public.splendor_practice_sessions from anon,authenticated;
grant all on public.splendor_practice_sessions to service_role;
create index if not exists splendor_practice_owner on public.splendor_practice_sessions(owner_id);
