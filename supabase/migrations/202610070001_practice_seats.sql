-- Practice tables seat one human among 1–3 chosen bots. Null seats mean the legacy
-- two-seat table: the human at seat 0 against the public Greedy baseline.
alter table public.splendor_practice_sessions
 add column if not exists seats jsonb,
 add column if not exists human_seat integer not null default 0;
drop function if exists public.splendor_create_practice(uuid,uuid,jsonb,jsonb);
create or replace function public.splendor_create_practice(p_owner uuid,p_id uuid,p_state jsonb,p_clock jsonb,p_seats jsonb default null,p_human_seat integer default 0)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 delete from splendor_practice_sessions where owner_id=p_owner and updated_at<now()-interval '1 day';
 if (select count(*) from splendor_practice_sessions where owner_id=p_owner)>=2 then
  raise exception 'Close an existing practice session first';
 end if;
 insert into splendor_practice_sessions(id,owner_id,state,clock,revision,seats,human_seat)
 values(p_id,p_owner,p_state,p_clock,(p_state->>'decision')::integer,p_seats,p_human_seat);
end $$;
revoke all on function public.splendor_create_practice(uuid,uuid,jsonb,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.splendor_create_practice(uuid,uuid,jsonb,jsonb,jsonb,integer) to service_role;
