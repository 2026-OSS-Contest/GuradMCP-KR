// Action strength ordering for severity-max adoption (GMCP-75, FR-POL-02,
// 부록 A.3 규칙 2). This is the single source of truth for action strength;
// evaluate.ts and index.ts's `evaluate()` both reduce over it.

import type { Action } from "./types.js";

export const ACTION_RANK: Record<Action, number> = {
  block: 4,
  require_approval: 3,
  warn: 2,
  mask_then_allow: 1,
  allow: 0
};
