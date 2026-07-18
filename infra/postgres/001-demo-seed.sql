BEGIN;

CREATE TABLE IF NOT EXISTS policy_packs (
  id text PRIMARY KEY,
  version integer NOT NULL,
  enabled boolean NOT NULL,
  description text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id text PRIMARY KEY,
  pack_id text NOT NULL REFERENCES policy_packs(id),
  priority integer NOT NULL,
  action text NOT NULL,
  severity text NOT NULL,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_sessions (
  id uuid PRIMARY KEY,
  scenario_id text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES demo_sessions(id),
  sequence_no integer NOT NULL,
  verdict text NOT NULL,
  tool_name text NOT NULL,
  policy_id text,
  risk_score integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (session_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES demo_sessions(id),
  status text NOT NULL,
  expires_at timestamptz NOT NULL
);

INSERT INTO policy_packs (id, version, enabled, description, updated_at) VALUES
  ('default', 1, true, 'Deterministic default protection policy pack', '2026-01-01T00:00:00Z'),
  ('korean-pii', 1, true, 'Deterministic Korean PII masking policy pack', '2026-01-01T00:00:00Z')
ON CONFLICT (id) DO UPDATE SET
  version = EXCLUDED.version,
  enabled = EXCLUDED.enabled,
  description = EXCLUDED.description,
  updated_at = EXCLUDED.updated_at;

INSERT INTO policies (id, pack_id, priority, action, severity, description) VALUES
  ('block_env_file_read', 'default', 100, 'block', 'critical', 'Block reads of credential files'),
  ('mask_korean_phone', 'korean-pii', 200, 'mask_then_allow', 'high', 'Mask Korean mobile phone numbers'),
  ('approve_external_email', 'default', 300, 'require_approval', 'high', 'Require approval for external email')
ON CONFLICT (id) DO UPDATE SET
  pack_id = EXCLUDED.pack_id,
  priority = EXCLUDED.priority,
  action = EXCLUDED.action,
  severity = EXCLUDED.severity,
  description = EXCLUDED.description;

INSERT INTO demo_sessions (id, scenario_id, title, created_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'T-01', 'Prompt injection to credential read', '2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000002', 'T-02', 'Korean PII masking', '2026-01-01T00:01:00Z')
ON CONFLICT (id) DO UPDATE SET
  scenario_id = EXCLUDED.scenario_id,
  title = EXCLUDED.title,
  created_at = EXCLUDED.created_at;

INSERT INTO audit_events
  (id, session_id, sequence_no, verdict, tool_name, policy_id, risk_score, occurred_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 1, 'block', 'read_file', 'block_env_file_read', 96, '2026-01-01T00:00:01Z'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 1, 'mask_then_allow', 'lookup_customer', 'mask_korean_phone', 82, '2026-01-01T00:01:01Z')
ON CONFLICT (id) DO UPDATE SET
  session_id = EXCLUDED.session_id,
  sequence_no = EXCLUDED.sequence_no,
  verdict = EXCLUDED.verdict,
  tool_name = EXCLUDED.tool_name,
  policy_id = EXCLUDED.policy_id,
  risk_score = EXCLUDED.risk_score,
  occurred_at = EXCLUDED.occurred_at;

INSERT INTO approvals (id, session_id, status, expires_at) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'pending', '2099-01-01T00:00:00Z')
ON CONFLICT (id) DO UPDATE SET
  session_id = EXCLUDED.session_id,
  status = EXCLUDED.status,
  expires_at = EXCLUDED.expires_at;

COMMIT;

