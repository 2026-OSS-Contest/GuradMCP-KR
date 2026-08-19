-- GMCP-83: fills in the SHA-256 hash chain V1 left schema-only
-- (docs/task-docs/GMCP-83/audit-hash-chain-spec.md §2/§3).
--
-- prev_hash/hash stay nullable (V1 already made them nullable text, not the spec's CHAR(64) —
-- kept consistent with this table's existing convention) and the new seq column is nullable
-- too: a row written before this ticket has no chain to check, and
-- GuardEventHasher.verify reports UNKNOWN for a session containing one rather than a false
-- BROKEN. Every row inserted from this point on (GuardEventRepository.insert) always fills
-- all three under a per-session lock.
ALTER TABLE guard_event
  ADD COLUMN seq BIGINT;

-- Postgres treats every NULL as distinct in a unique index, so pre-chain (seq IS NULL) rows
-- never collide with each other or with chained ones.
CREATE UNIQUE INDEX guard_event_session_seq_idx ON guard_event (session_id, seq);
CREATE INDEX guard_event_session_hash_idx ON guard_event (session_id, hash);
