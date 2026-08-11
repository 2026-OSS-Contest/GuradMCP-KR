BEGIN;

CREATE TABLE IF NOT EXISTS mcp_servers (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  endpoint text NOT NULL,
  trust_level text NOT NULL,
  connection_status text NOT NULL,
  tool_snapshot_hash text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  trust_level_updated_at timestamptz NOT NULL,
  trust_level_updated_by text
);

CREATE TABLE IF NOT EXISTS trust_level_change_events (
  event_id uuid PRIMARY KEY,
  ts timestamptz NOT NULL,
  server_id uuid NOT NULL REFERENCES mcp_servers(id),
  from_trust text NOT NULL,
  to_trust text NOT NULL,
  direction text NOT NULL,
  confirmed_by text,
  prev_hash text NOT NULL,
  hash text NOT NULL
);

-- Mirrors ServerRegistryStore's seed (services/control-plane/.../domain/ServerRegistryStore.kt)
-- and DemoSeed.kt's SERVER_FILE_ID/SERVER_MAIL_ID/SERVER_DB_ID constants, same as
-- 001-demo-seed.sql mirrors PolicyStore/GuardEventStore/ApprovalStore. The application itself
-- still holds this state in-memory (services/control-plane/.../ServerRegistryStore.kt) rather
-- than reading this table; see infra/postgres/001-demo-seed.sql's header note for why.
INSERT INTO mcp_servers
  (id, name, endpoint, trust_level, connection_status, tool_snapshot_hash, created_at, updated_at, trust_level_updated_at, trust_level_updated_by)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'file-server', 'http://demo-mcp-tools:3003', 'limited', 'connected', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL),
  ('30000000-0000-4000-8000-000000000002', 'mail-server', 'http://mail-server.internal:3004', 'trusted', 'connected', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL),
  ('30000000-0000-4000-8000-000000000003', 'db-server', 'http://db-server.internal:3005', 'untrusted', 'disconnected', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  endpoint = EXCLUDED.endpoint,
  trust_level = EXCLUDED.trust_level,
  connection_status = EXCLUDED.connection_status,
  tool_snapshot_hash = EXCLUDED.tool_snapshot_hash,
  updated_at = EXCLUDED.updated_at,
  trust_level_updated_at = EXCLUDED.trust_level_updated_at,
  trust_level_updated_by = EXCLUDED.trust_level_updated_by;

COMMIT;
