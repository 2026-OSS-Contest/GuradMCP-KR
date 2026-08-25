-- GMCP-84 (docs/task-docs/GMCP-84/spec-nfr04-log-masking-reveal-audit.md §5): splits the raw
-- payload out of guard_event into its own table, so "does a row exist in raw_payload" alone
-- proves whether raw content was ever stored for an event, and encrypts it at rest
-- (AES-256-GCM, key from an env var — KMS key management is explicitly out of scope, §2).
--
-- No retroactive migration of the old V1 guard_event.raw_payload column: §5.2 says opt-in
-- storage never applies retroactively to events written before opt-in was turned on, and that
-- column has only ever held data while guard_settings.store_raw_opt_in defaulted to false in
-- every environment this has shipped to (V4) — there is nothing to carry forward.
ALTER TABLE guard_event
  ADD COLUMN raw_payload_ref uuid;

ALTER TABLE guard_event
  DROP COLUMN raw_payload;

CREATE TABLE raw_payload (
  raw_payload_id          uuid PRIMARY KEY,
  event_id                uuid NOT NULL REFERENCES guard_event (event_id),
  payload_encrypted       bytea NOT NULL,
  encryption_key_version  text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX raw_payload_event_id_idx ON raw_payload (event_id);

-- §5.3. `event_id` is deliberately NOT a foreign key: §6.3 checks permission (step 1) before it
-- ever looks up the GuardEvent (step 2), so a denied_no_permission row can legitimately name an
-- eventId this table -- or even guard_event -- has never heard of. See
-- AuditEventController.reveal for the exact ordering this table has to tolerate.
CREATE TABLE reveal_audit_log (
  reveal_id     uuid PRIMARY KEY,
  event_id      uuid NOT NULL,
  revealed_by   text NOT NULL,
  revealed_at   timestamptz NOT NULL DEFAULT now(),
  reason        text,
  source_ip     text,
  result        text NOT NULL CHECK (result IN ('success', 'denied_no_permission', 'denied_not_stored'))
);

CREATE INDEX reveal_audit_log_event_id_idx ON reveal_audit_log (event_id);
CREATE INDEX reveal_audit_log_revealed_at_idx ON reveal_audit_log (revealed_at);

-- §5.4: opt-in provenance, layered on top of V4's flag. Renamed to match the spec's wire field
-- (`rawPayloadStorageEnabled`, GET/PUT /api/v1/settings §6.1/6.2) rather than left as
-- `store_raw_opt_in` with only the JSON name diverging -- one name, everywhere.
ALTER TABLE guard_settings
  RENAME COLUMN store_raw_opt_in TO raw_payload_storage_enabled;

ALTER TABLE guard_settings
  ADD COLUMN raw_payload_storage_enabled_at timestamptz,
  ADD COLUMN raw_payload_storage_enabled_by text;
