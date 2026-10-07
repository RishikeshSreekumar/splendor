-- Personal access tokens for MCP clients (Claude, Codex). Only SHA-256 digests are stored.
create table if not exists public.splendor_api_tokens (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 60), token_hash text not null unique,
 prefix text not null, created_at timestamptz not null default now(), last_used_at timestamptz,
 revoked_at timestamptz
);
create index if not exists splendor_api_tokens_owner on public.splendor_api_tokens(owner_id,created_at desc);
alter table public.splendor_api_tokens enable row level security;
revoke all on public.splendor_api_tokens from anon,authenticated;
grant all on public.splendor_api_tokens to service_role;

-- Token buckets keyed by user or IP and policy. Mirrors `consume` in src/server/rate-limit.ts.
create table if not exists public.splendor_rate_limits (
 key text primary key, tokens double precision not null, updated_at timestamptz not null,
 strikes integer not null default 0, blocked_until timestamptz not null default '-infinity'
);
alter table public.splendor_rate_limits enable row level security;
revoke all on public.splendor_rate_limits from anon,authenticated;
grant all on public.splendor_rate_limits to service_role;
create or replace function public.splendor_rate_limit(p_key text,p_capacity integer,p_window_seconds integer,p_backoff_seconds integer,p_max_block_seconds integer)
returns table(allowed boolean,retry_after_seconds integer) language plpgsql security definer set search_path=public as $$
declare
 b splendor_rate_limits%rowtype;
 t timestamptz := clock_timestamp();
 rate double precision := p_capacity::double precision/p_window_seconds;
 refill double precision; penalty double precision;
begin
 insert into splendor_rate_limits(key,tokens,updated_at) values(p_key,p_capacity,t) on conflict (key) do nothing;
 select * into b from splendor_rate_limits where key=p_key for update;
 b.tokens := least(p_capacity::double precision, b.tokens + greatest(0, extract(epoch from t-b.updated_at))*rate);
 if b.strikes>0 and t > b.blocked_until + interval '1 hour' then b.strikes := 0; end if;
 if t >= b.blocked_until and b.tokens >= 1 then
  update splendor_rate_limits set tokens=b.tokens-1,updated_at=t,strikes=b.strikes where key=p_key;
  return query select true, 0;
  return;
 end if;
 if p_backoff_seconds>0 then b.strikes := b.strikes+1; end if;
 refill := case when b.tokens>=1 then 0 else (1-b.tokens)/rate end;
 penalty := case when p_backoff_seconds>0 then least(p_max_block_seconds::double precision, p_backoff_seconds*power(2,b.strikes-1)) else 0 end;
 b.blocked_until := greatest(b.blocked_until, t + make_interval(secs => greatest(refill,penalty)));
 update splendor_rate_limits set tokens=b.tokens,updated_at=t,strikes=b.strikes,blocked_until=b.blocked_until where key=p_key;
 return query select false, greatest(1, ceil(extract(epoch from b.blocked_until-t))::integer);
end $$;
revoke all on function public.splendor_rate_limit(text,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.splendor_rate_limit(text,integer,integer,integer,integer) to service_role;

-- One unfinished practice game per user. Finished boards are cleared on the next start.
-- An unfinished board blocks a new one (SQLSTATE SPL09, detail = its id) unless p_replace
-- abandons it. A board whose move is still running cannot be replaced (SPL29) until the
-- move ends or is recovered after two minutes.
drop function if exists public.splendor_create_practice(uuid,uuid,jsonb,jsonb,jsonb,integer);
create or replace function public.splendor_create_practice(p_owner uuid,p_id uuid,p_state jsonb,p_clock jsonb,p_seats jsonb,p_human_seat integer,p_replace boolean default false,p_busy boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare active splendor_practice_sessions%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 delete from splendor_practice_sessions where owner_id=p_owner
  and (updated_at<now()-interval '1 day' or state->>'status'='finished');
 select * into active from splendor_practice_sessions where owner_id=p_owner order by updated_at desc limit 1;
 if found then
  if not p_replace then
   raise exception using errcode='SPL09', message='Finish or abandon your unfinished game first', detail=active.id::text;
  end if;
  if exists(select 1 from splendor_practice_sessions where owner_id=p_owner and busy and updated_at>now()-interval '2 minutes') then
   raise exception using errcode='SPL29', message='A move is still running in your current game; try again shortly';
  end if;
  delete from splendor_practice_sessions where owner_id=p_owner;
 end if;
 insert into splendor_practice_sessions(id,owner_id,state,clock,revision,seats,human_seat,busy)
 values(p_id,p_owner,p_state,p_clock,(p_state->>'decision')::integer,p_seats,p_human_seat,p_busy);
end $$;
revoke all on function public.splendor_create_practice(uuid,uuid,jsonb,jsonb,jsonb,integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.splendor_create_practice(uuid,uuid,jsonb,jsonb,jsonb,integer,boolean,boolean) to service_role;
