-- Reserve practice capacity under the same per-owner transaction lock as jobs.
create or replace function public.splendor_create_practice(p_owner uuid,p_id uuid,p_state jsonb,p_clock jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 delete from splendor_practice_sessions where owner_id=p_owner and updated_at<now()-interval '1 day';
 if (select count(*) from splendor_practice_sessions where owner_id=p_owner)>=2 then
  raise exception 'Close an existing practice session first';
 end if;
 insert into splendor_practice_sessions(id,owner_id,state,clock,revision)
 values(p_id,p_owner,p_state,p_clock,(p_state->>'decision')::integer);
end $$;
revoke all on function public.splendor_create_practice(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.splendor_create_practice(uuid,uuid,jsonb,jsonb) to service_role;
