-- Corrective hardening for Phase 11B operation persistence.
-- Service-role access is server-only; no browser role may read or mutate operation history.
alter table substitution_operations enable row level security;
alter table substitution_operation_events enable row level security;
alter table substitution_outbox enable row level security;

revoke all on substitution_operations, substitution_operation_events, substitution_outbox from anon, authenticated;
revoke execute on function create_substitution_operation(uuid, text, text, text, text, text, numeric, text, jsonb) from public;
grant execute on function create_substitution_operation(uuid, text, text, text, text, text, numeric, text, jsonb) to service_role;

-- PostgreSQL treats NULL values as distinct in a unique constraint. This partial index is the
-- actual idempotency guard for a still-undelivered work item.
create unique index if not exists substitution_outbox_one_pending_work_item
  on substitution_outbox (operation_id, event_type)
  where delivered_at is null;
