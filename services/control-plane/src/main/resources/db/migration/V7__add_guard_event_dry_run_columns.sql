-- SPEC-POL-04 §4.1 (GMCP-77): dry-run (shadow policy group) fields alongside the real verdict.
--
-- `dry_run_verdict` is nullable, not defaulted to 'allow': null means "no shadow policy
-- matched this event" (GuardEvent.dryRunVerdict is absent, never a synthesized value), which
-- is a different fact than a shadow group that matched and settled on 'allow'.
-- `dry_run_matched_policy_ids`/`would_escalate` default to the "nothing shadow-matched" case
-- ('{}' / false) so every pre-GMCP-77 row reads as exactly that on the very first query.
ALTER TABLE guard_event
  ADD COLUMN dry_run_verdict text CHECK (dry_run_verdict IN ('allow', 'warn', 'mask_then_allow', 'require_approval', 'block')),
  ADD COLUMN dry_run_matched_policy_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN would_escalate boolean NOT NULL DEFAULT false;
