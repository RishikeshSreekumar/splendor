-- Shared tables: the host can leave seats open for friends, who join from an invite link.
-- `guests` holds each joined player's seat, account and the SHA-256 of their seat token.
-- `history` keeps the latest decisions (with the state after each) so a waiting player can
-- replay moves made by others; the API trims it to a few rounds.
alter table public.splendor_practice_sessions
 add column if not exists guests jsonb not null default '[]'::jsonb,
 add column if not exists history jsonb not null default '[]'::jsonb;

create or replace function public.splendor_join_practice(p_id uuid,p_name text,p_user uuid,p_token_hash text)
returns integer language plpgsql security definer set search_path=public as $$
declare
 game splendor_practice_sessions%rowtype;
 seat integer;
begin
 select * into game from splendor_practice_sessions where id=p_id for update;
 if not found then
  raise exception using errcode='SPL09', message='This game has ended.';
 end if;
 if game.state->>'status'<>'playing' then
  raise exception using errcode='SPL09', message='This game has finished';
 end if;
 select (s.ordinality-1)::integer into seat
 from jsonb_array_elements(coalesce(game.seats,'[]'::jsonb)) with ordinality s
 where s.value->>'kind'='human' and coalesce((s.value->>'open')::boolean,false)
 order by s.ordinality limit 1;
 if seat is null then
  raise exception using errcode='SPL09', message='This table has no open seat';
 end if;
 update splendor_practice_sessions set
  seats=jsonb_set(seats,array[seat::text],jsonb_build_object('kind','human','name',p_name)),
  guests=guests||jsonb_build_array(jsonb_build_object('seat',seat,'token_hash',p_token_hash,'user_id',p_user)),
  updated_at=now()
 where id=p_id;
 return seat;
end $$;
revoke all on function public.splendor_join_practice(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.splendor_join_practice(uuid,text,uuid,text) to service_role;
