create or replace function lookup_auth_session(p_session_token_hash text)
returns table(session_id uuid, wallet_address text, organization_id uuid, organization_slug text, organization_display_name text, membership_role text, expires_at timestamptz) language sql stable as $$
  select s.id, s.wallet_address, o.id, o.slug, o.display_name, m.role, s.expires_at
  from auth_sessions s join institutional_memberships m on m.organization_id = s.organization_id and m.wallet_address = s.wallet_address
  join institutional_organizations o on o.id = s.organization_id
  where s.session_token_hash = p_session_token_hash and s.revoked_at is null and s.expires_at > now()
    and m.status = 'ACTIVE' and m.revoked_at is null and o.environment = 'TESTNET'
  limit 1
$$;
revoke execute on function lookup_auth_session(text) from public;
grant execute on function lookup_auth_session(text) to service_role;
