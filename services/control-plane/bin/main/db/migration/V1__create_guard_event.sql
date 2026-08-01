-- GMCP-24: Audit Logger persistence (docs/task-docs/GMCP-24/audit-logging-implementation.md §4).
--
-- Two deliberate deviations from the spec table, both because they follow what the
-- gateway actually emits (GMCP-15, packages/gateway/src/pipeline/types.ts) rather than
-- the spec's shorthand:
--   * session_id is `text`, not `uuid` — the gateway falls back to `req-<uuid>` style ids
--     when the caller doesn't supply a session id (server.ts `sessionIdOf`).
--   * verdict allows `mask_then_allow` in addition to the spec's four values — the policy
--     engine's Action type (packages/policy-engine/src/types.ts) has five actions, and the
--     action router emits all of them as GuardEvent.verdict.
--   * direction stores `request`/`response` (the gateway's actual wire values), not the
--     spec table's `req`/`res` abbreviation.
--
-- prev_hash/hash are schema-only for this ticket (GMCP-83 fills them in); always null here.
CREATE TABLE guard_event (
  event_id           uuid PRIMARY KEY,
  session_id         text NOT NULL,
  ts                 timestamptz NOT NULL,
  direction          text NOT NULL CHECK (direction IN ('request', 'response')),
  tool_name          text NOT NULL,
  args_digest        text NOT NULL,
  verdict            text NOT NULL CHECK (verdict IN ('allow', 'warn', 'mask_then_allow', 'require_approval', 'block')),
  risk_score         numeric NOT NULL,
  matched_policy_ids text[] NOT NULL DEFAULT '{}',
  detections         jsonb NOT NULL DEFAULT '[]',
  mask_diff_ref      text,
  -- NFR-04 opt-in only; null unless both the gateway (AUDIT_STORE_RAW_PAYLOAD) and this
  -- service (audit.store-raw-payload) have raw storage explicitly enabled.
  raw_payload        text,
  prev_hash          text,
  hash               text
);

CREATE INDEX guard_event_session_id_idx ON guard_event (session_id);
CREATE INDEX guard_event_ts_idx ON guard_event (ts);
CREATE INDEX guard_event_verdict_idx ON guard_event (verdict);
CREATE INDEX guard_event_tool_name_idx ON guard_event (tool_name);
