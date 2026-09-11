-- Phase 11B. PostgreSQL owns Usance operation/orchestration state only; Hedera remains financial authority.
create extension if not exists pgcrypto;
create table if not exists substitution_operations (
  operation_id uuid primary key,
  request_id text not null unique,
  facility_id text not null,
  home_domain text not null,
  old_instrument_id text not null,
  replacement_instrument_id text not null,
  requested_units numeric(78, 0) not null check (requested_units > 0),
  state text not null,
  pinned_risk_epoch bigint,
  policy_version bigint,
  ens_authority_digest text,
  ens_observed_block bigint,
  authority_expiry timestamptz,
  privy_approval_reference text,
  privy_approval_expiry timestamptz,
  cre_policy_commitment text,
  cre_execution_reference text,
  cre_decision text,
  cre_expiry timestamptz,
  commit_tx_id text,
  release_tx_id text,
  actual_committed_units numeric(78, 0),
  last_reconciled_at timestamptz,
  refusal_code text,
  schema_version integer not null default 1,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists substitution_operations_one_active_facility
  on substitution_operations (facility_id)
  where state not in ('COMPLETED', 'REFUSED', 'EXPIRED', 'CANCELLED');
create table if not exists substitution_operation_events (
  event_id uuid primary key,
  operation_id uuid not null references substitution_operations(operation_id),
  sequence integer not null check (sequence > 0),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  source text not null,
  source_reference text,
  observed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (operation_id, sequence)
);
create table if not exists substitution_outbox (
  outbox_id uuid primary key,
  operation_id uuid not null references substitution_operations(operation_id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  attempts integer not null default 0,
  unique (operation_id, event_type, delivered_at)
);
create or replace function create_substitution_operation(
  p_operation_id uuid, p_request_id text, p_facility_id text, p_home_domain text,
  p_old_instrument_id text, p_replacement_instrument_id text, p_requested_units numeric,
  p_state text, p_payload jsonb
) returns substitution_operations language plpgsql as $$
declare result substitution_operations;
begin
  insert into substitution_operations (
    operation_id, request_id, facility_id, home_domain, old_instrument_id,
    replacement_instrument_id, requested_units, state
  ) values (
    p_operation_id, p_request_id, p_facility_id, p_home_domain, p_old_instrument_id,
    p_replacement_instrument_id, p_requested_units, p_state
  ) on conflict (request_id) do update set request_id = excluded.request_id
  returning * into result;
  if result.operation_id = p_operation_id then
    insert into substitution_operation_events (event_id, operation_id, sequence, event_type, payload, source)
      values (gen_random_uuid(), result.operation_id, 1, 'OPERATION_CREATED', p_payload, 'USANCE_API');
    insert into substitution_outbox (outbox_id, operation_id, event_type, payload)
      values (gen_random_uuid(), result.operation_id, 'RECONCILE_OPERATION', p_payload);
  end if;
  return result;
end $$;
