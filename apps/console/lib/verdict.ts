import type { GuardAction, Verdict } from "@/lib/api/types";

/**
 * The control plane and the screens name these outcomes differently, and it has one more of them
 * than the UI does: `warn` records a finding and `mask_then_allow` rewrites the payload, but both
 * mean the call went through with something on the record, which is the rail's one 경고 colour.
 * Anything crossing that boundary converts here rather than each screen inventing its own mapping.
 */
const VERDICT: Record<GuardAction, Verdict> = {
  allow: "allow",
  warn: "warn",
  mask_then_allow: "warn",
  require_approval: "require_approval",
  block: "block"
};

export function toVerdict(action: GuardAction): Verdict {
  return VERDICT[action] ?? "allow";
}
