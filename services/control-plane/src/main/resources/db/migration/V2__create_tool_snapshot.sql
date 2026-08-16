-- GMCP-65: Tool definition snapshot & Rug Pull drift detection (FR-GW-03, threat T-05).
--
-- Three tables, not the two the spec's §4 data model names, because the spec's own
-- acceptance criteria (§9.2) require a "미승인" (unapproved) server's tools to still
-- appear in GET /servers with a name and a `lastCheckedAt` — information that cannot
-- come from `tool_snapshot` alone, since an unapproved server has no active snapshot
-- row by definition (§5.1.3). `tool_observation` is the mutable "what did we last see"
-- record; `tool_snapshot` stays the immutable approved baseline described in §4.
CREATE TABLE tool_snapshot (
  id            uuid PRIMARY KEY,
  server_id     uuid NOT NULL,
  tool_name     text NOT NULL,
  description   text NOT NULL,
  input_schema  jsonb NOT NULL,
  -- Computed and compared only on the gateway side (packages/gateway/src/tool-snapshot.ts);
  -- this column stores it as an opaque string and never recomputes or re-derives it.
  fingerprint   text NOT NULL,
  captured_at   timestamptz NOT NULL,
  captured_by   text NOT NULL,
  status        text NOT NULL CHECK (status IN ('active', 'superseded'))
);

-- At most one active snapshot per (server, tool) — re-approval must supersede the
-- previous row before inserting a new one, never leave two active rows racing (§5.1.4).
CREATE UNIQUE INDEX tool_snapshot_active_idx ON tool_snapshot (server_id, tool_name) WHERE status = 'active';
CREATE INDEX tool_snapshot_server_id_idx ON tool_snapshot (server_id);

CREATE TABLE tool_definition_diff (
  id              uuid PRIMARY KEY,
  server_id       uuid NOT NULL,
  tool_name       text NOT NULL,
  -- Null only for tool_added: a newly-appeared tool has no prior snapshot row of its own
  -- to point at (§4: "비교 기준이 된 ToolSnapshot").
  snapshot_id     uuid REFERENCES tool_snapshot (id),
  diff_type       text NOT NULL CHECK (diff_type IN ('tool_added', 'tool_removed', 'description_changed', 'schema_changed')),
  before          jsonb,
  after           jsonb,
  detected_at     timestamptz NOT NULL,
  acknowledged    boolean NOT NULL DEFAULT false,
  acknowledged_by text,
  acknowledged_at timestamptz
);

CREATE INDEX tool_definition_diff_server_tool_idx ON tool_definition_diff (server_id, tool_name);
CREATE INDEX tool_definition_diff_pending_idx ON tool_definition_diff (server_id, tool_name) WHERE acknowledged = false;

-- Latest `tools/list` observation per (server, tool), independent of whether a baseline
-- exists yet. Upserted on every gateway report (§5.2) — this is the source of
-- `lastCheckedAt` and of the tool names an unapproved server still shows in the console
-- inventory (§6.1 `state: "unapproved"`).
CREATE TABLE tool_observation (
  server_id     uuid NOT NULL,
  tool_name     text NOT NULL,
  description   text NOT NULL,
  input_schema  jsonb NOT NULL,
  fingerprint   text NOT NULL,
  observed_at   timestamptz NOT NULL,
  PRIMARY KEY (server_id, tool_name)
);
