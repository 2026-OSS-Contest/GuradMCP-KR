// Action/severity strength orderings for severity-max adoption (GMCP-75,
// FR-POL-02, 부록 A.3 규칙 2). These are the single source of truth for
// action/severity strength; evaluate.ts and index.ts's `evaluate()` both
// reduce over ACTION_RANK, and evaluate.ts's tie-break also reduces over
// SEVERITY_RANK.

import type { Action, Severity } from "./types.js";

export const ACTION_RANK: Record<Action, number> = {
  block: 4,
  require_approval: 3,
  warn: 2,
  mask_then_allow: 1,
  allow: 0
};

// Tie-break when ACTION_RANK is equal: higher severity wins.
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0
};
