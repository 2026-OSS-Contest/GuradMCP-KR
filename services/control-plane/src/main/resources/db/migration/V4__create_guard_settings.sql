-- GMCP-68: fail-closed failure policy + fail-open opt-in
-- (docs/task-docs/GMCP-68/fail-closed-failsafe-policy-spec.md §3.1).
--
-- Two deliberate deviations from the spec table:
--   * `text` + `CHECK` rather than a native Postgres ENUM for failure_policy/locale — this
--     codebase reads/writes every column here through raw JdbcTemplate (see guard_event's own
--     verdict/direction columns, V1), and a native enum only adds casting friction there.
--   * Also carries the three settings SCR-501 already renders (store_raw_opt_in/locale/
--     approval_timeout_seconds — apps/console/lib/api/types.ts `GatewaySettings`). This is the
--     `GET/PUT /api/v1/settings` endpoint the console's `getSettings`/`updateSettings` already
--     call, so it answers the whole shape rather than leaving those three still unbacked.
--     Only failure_policy/risk_acknowledged carry the acknowledgement/audit rules this ticket
--     specifies; the other three are plain stored fields with no extra validation.
CREATE TABLE guard_settings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  failure_policy           text NOT NULL DEFAULT 'fail_closed' CHECK (failure_policy IN ('fail_closed', 'fail_open')),
  risk_acknowledged         boolean NOT NULL DEFAULT false,
  risk_acknowledged_at      timestamptz,
  store_raw_opt_in          boolean NOT NULL DEFAULT false,
  locale                   text NOT NULL DEFAULT 'ko' CHECK (locale IN ('ko', 'en')),
  approval_timeout_seconds  integer NOT NULL DEFAULT 120,
  updated_by               text,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  bigint NOT NULL DEFAULT 1
);

-- Single-row settings singleton (§3.1: "단일 행 보장").
INSERT INTO guard_settings DEFAULT VALUES;
