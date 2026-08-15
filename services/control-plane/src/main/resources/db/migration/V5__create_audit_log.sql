-- GMCP-68 §3.3/§5.2: queryable audit trail for settings changes. `fail_open` activation is the
-- one this exists for — recorded at severity=high so it stands out from routine config edits in
-- the Replay/Home "최근 보안 이벤트" stream (§3.3).
--
-- Distinct from `guard_event` (V1: one row per Tool Call verdict) and from `AuditChain`'s
-- in-memory trust-change hash chain (server-trust only, not yet Postgres-backed) — this is the
-- first persisted, generic audit log, so its shape stays narrow (action/actor/before/after)
-- rather than trying to unify with either of those.
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text NOT NULL,
  actor       text NOT NULL,
  before      jsonb NOT NULL DEFAULT '{}',
  after       jsonb NOT NULL DEFAULT '{}',
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'high')),
  request_ip  text,
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_action_idx ON audit_log (action);
CREATE INDEX audit_log_ts_idx ON audit_log (ts);
