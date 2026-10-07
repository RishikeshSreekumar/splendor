alter table public.splendor_bots add column if not exists secrets_encrypted text, add column if not exists secrets_fingerprint text not null default '';
alter table public.splendor_bots drop constraint if exists splendor_bots_owner_id_name_project_hash_key;
create unique index if not exists splendor_bot_configuration on public.splendor_bots(owner_id,name,project_hash,secrets_fingerprint);
create or replace function public.splendor_reserve_work(p_owner uuid,p_kind text,p_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if p_kind='bot' then
  if (select count(*) from splendor_bots where owner_id=p_owner and created_at>now()-interval '1 day') >= 20 then raise exception 'Daily submission limit reached'; end if;
  if (select count(*) from splendor_bots where owner_id=p_owner and qualification='pending') >= 2 then raise exception 'Wait for your pending qualification'; end if;
  insert into splendor_bots(id,owner_id,name,source_hash,project_hash,artifact_key,secrets_encrypted,secrets_fingerprint) values(p_id,p_owner,p_payload->>'name',p_payload->>'source_hash',p_payload->>'project_hash',p_payload->>'artifact_key',p_payload->>'secrets_encrypted',coalesce(p_payload->>'secrets_fingerprint',''));
 elsif p_kind='evaluation' then
  if (select count(*) from splendor_evaluations where owner_id=p_owner and status in ('queued','running')) >= 2 then raise exception 'Wait for your active evaluations'; end if;
  if (select count(*) from splendor_evaluations where owner_id=p_owner and created_at>now()-interval '1 day') >= 20 then raise exception 'Daily evaluation limit reached'; end if;
  insert into splendor_evaluations(id,owner_id,config,total_games) values(p_id,p_owner,p_payload->'config',(p_payload->>'total_games')::integer);
 else raise exception 'Invalid work kind'; end if;
end $$;
revoke all on function public.splendor_reserve_work(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.splendor_reserve_work(uuid,text,uuid,jsonb) to service_role;
