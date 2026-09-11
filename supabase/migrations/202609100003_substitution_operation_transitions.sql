-- Every operation state change appends its audit event in the same transaction.
create or replace function transition_substitution_operation(
  p_operation_id uuid, p_expected_version integer, p_next_state text, p_event_type text,
  p_payload jsonb, p_source text, p_source_reference text, p_outbox_event_type text default null
) returns substitution_operations language plpgsql as $$
declare result substitution_operations; next_sequence integer;
begin
  select * into result from substitution_operations where operation_id = p_operation_id for update;
  if not found then raise exception 'operation not found' using errcode = 'P0002'; end if;
  if result.version <> p_expected_version then raise exception 'stale operation version' using errcode = '40001'; end if;
  if result.state in ('COMPLETED', 'REFUSED', 'EXPIRED', 'CANCELLED') then raise exception 'terminal operation' using errcode = '23514'; end if;
  select coalesce(max(sequence), 0) + 1 into next_sequence from substitution_operation_events where operation_id = p_operation_id;
  update substitution_operations set state = p_next_state, version = version + 1, updated_at = now() where operation_id = p_operation_id returning * into result;
  insert into substitution_operation_events (event_id, operation_id, sequence, event_type, payload, source, source_reference)
    values (gen_random_uuid(), result.operation_id, next_sequence, p_event_type, p_payload, p_source, p_source_reference);
  if p_outbox_event_type is not null then
    insert into substitution_outbox (outbox_id, operation_id, event_type, payload)
      values (gen_random_uuid(), result.operation_id, p_outbox_event_type, p_payload)
      on conflict (operation_id, event_type) where delivered_at is null do nothing;
  end if;
  return result;
end $$;
revoke execute on function transition_substitution_operation(uuid, integer, text, text, jsonb, text, text, text) from public;
grant execute on function transition_substitution_operation(uuid, integer, text, text, jsonb, text, text, text) to service_role;
