create or replace function create_auth_challenge(p_wallet_address text, p_nonce_hash text, p_domain text, p_uri text, p_chain_id integer, p_statement text, p_issued_at timestamptz, p_expires_at timestamptz)
returns auth_challenges language plpgsql as $$ declare result auth_challenges; begin
  insert into auth_challenges (wallet_address, nonce_hash, domain, uri, chain_id, statement, issued_at, expires_at)
  values (lower(p_wallet_address), p_nonce_hash, p_domain, p_uri, p_chain_id, p_statement, p_issued_at, p_expires_at) returning * into result;
  return result;
end $$;

create or replace function consume_auth_challenge_and_create_session(p_challenge_id uuid, p_wallet_address text, p_session_token_hash text, p_session_expires_at timestamptz)
returns table(session_id uuid, wallet_address text, organization_id uuid, organization_slug text, organization_display_name text, membership_id uuid, membership_role text, expires_at timestamptz) language plpgsql as $$
declare c auth_challenges; m institutional_memberships; o institutional_organizations; sid uuid;
begin
  select * into c from auth_challenges where id = p_challenge_id for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if c.consumed_at is not null then raise exception 'CHALLENGE_CONSUMED' using errcode = '23505'; end if;
  if c.expires_at <= now() then raise exception 'CHALLENGE_EXPIRED' using errcode = '22023'; end if;
  if c.wallet_address <> lower(p_wallet_address) then raise exception 'CHALLENGE_WALLET_MISMATCH' using errcode = '22023'; end if;
  select im.* into m from institutional_memberships im where im.wallet_address = c.wallet_address and im.status = 'ACTIVE' and im.revoked_at is null limit 1 for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
  if m.role <> 'TESTNET_OPERATOR' then raise exception 'ROLE_NOT_ALLOWED' using errcode = '42501'; end if;
  select * into o from institutional_organizations where id = m.organization_id and environment = 'TESTNET' for update;
  if not found then raise exception 'MEMBERSHIP_INACTIVE' using errcode = 'P0002'; end if;
  update auth_challenges set consumed_at = now() where id = c.id;
  insert into auth_sessions (session_token_hash, wallet_address, organization_id, expires_at) values (p_session_token_hash, c.wallet_address, o.id, p_session_expires_at) returning id into sid;
  return query select sid, c.wallet_address, o.id, o.slug, o.display_name, m.id, m.role, p_session_expires_at;
end $$;

create or replace function revoke_auth_session(p_session_token_hash text) returns boolean language plpgsql as $$ begin
  update auth_sessions set revoked_at = coalesce(revoked_at, now()) where session_token_hash = p_session_token_hash; return found;
end $$;

revoke execute on function create_auth_challenge(text,text,text,text,integer,text,timestamptz,timestamptz) from public;
revoke execute on function consume_auth_challenge_and_create_session(uuid,text,text,timestamptz) from public;
revoke execute on function revoke_auth_session(text) from public;
grant execute on function create_auth_challenge(text,text,text,text,integer,text,timestamptz,timestamptz) to service_role;
grant execute on function consume_auth_challenge_and_create_session(uuid,text,text,timestamptz) to service_role;
grant execute on function revoke_auth_session(text) to service_role;
