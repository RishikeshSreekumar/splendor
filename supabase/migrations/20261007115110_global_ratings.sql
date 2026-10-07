-- Global Elo ladder for bots and human players. Ranked evaluation games and finished (or
-- abandoned) practice games feed it. The API computes new ratings (src/ratings.ts) and applies
-- them here with optimistic versions, so concurrent sources never overwrite each other.
create table if not exists public.splendor_ratings (
 key text primary key, kind text not null check(kind in ('bot','user')), subject_id uuid not null,
 elo double precision not null, games integer not null default 0, wins integer not null default 0,
 draws integer not null default 0, losses integer not null default 0,
 version integer not null default 1, updated_at timestamptz not null default now()
);
create index if not exists splendor_ratings_kind_elo on public.splendor_ratings(kind,elo desc);
-- Each evaluation or practice game is applied at most once.
create table if not exists public.splendor_rating_sources (
 source text primary key, applied_at timestamptz not null default now()
);
alter table public.splendor_ratings enable row level security;
alter table public.splendor_rating_sources enable row level security;
revoke all on public.splendor_ratings,public.splendor_rating_sources from anon,authenticated;
grant all on public.splendor_ratings,public.splendor_rating_sources to service_role;
-- SPL41: source already applied. SPL40: a rating changed since it was read; re-read and retry.
create or replace function public.splendor_apply_ratings(p_source text,p_rows jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
 perform pg_advisory_xact_lock(hashtextextended('splendor_ratings',0));
 if exists(select 1 from splendor_rating_sources where source=p_source) then
  raise exception using errcode='SPL41', message='Ratings already applied';
 end if;
 for r in select * from jsonb_to_recordset(p_rows) as x(key text,kind text,subject_id uuid,elo double precision,games integer,wins integer,draws integer,losses integer,version integer) loop
  if coalesce((select version from splendor_ratings where key=r.key),0) <> r.version then
   raise exception using errcode='SPL40', message='Ratings changed concurrently';
  end if;
  insert into splendor_ratings(key,kind,subject_id,elo,games,wins,draws,losses,version,updated_at)
  values(r.key,r.kind,r.subject_id,r.elo,r.games,r.wins,r.draws,r.losses,r.version+1,now())
  on conflict (key) do update set elo=excluded.elo,games=excluded.games,wins=excluded.wins,
   draws=excluded.draws,losses=excluded.losses,version=excluded.version,updated_at=now();
 end loop;
 insert into splendor_rating_sources(source) values(p_source);
end $$;
revoke all on function public.splendor_apply_ratings(text,jsonb) from public,anon,authenticated;
grant execute on function public.splendor_apply_ratings(text,jsonb) to service_role;

-- Unfinished games are no longer purged silently after a day: that would let a player dodge a
-- losing game by waiting. They stay until finished, abandoned (rated), or the weekly sweep.
create or replace function public.splendor_create_practice(p_owner uuid,p_id uuid,p_state jsonb,p_clock jsonb,p_seats jsonb,p_human_seat integer,p_replace boolean default false,p_busy boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare active splendor_practice_sessions%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 delete from splendor_practice_sessions where owner_id=p_owner and state->>'status'='finished';
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
