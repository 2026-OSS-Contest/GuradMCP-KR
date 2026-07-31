import type { GuardAction, Verdict } from "@/lib/api/types";

/**
 * The control plane and the screens name the same four outcomes differently — its
 * `mask_then_allow` is the UI's `warn`. Anything crossing that boundary converts here rather
 * than each screen inventing its own mapping.
 */
const VERDICT: Record<GuardAction, Verdict> = {
  allow: "allow",
  mask_then_allow: "warn",
  require_approval: "require_approval",
  block: "block"
};

export function toVerdict(action: GuardAction): Verdict {
  return VERDICT[action] ?? "allow";
}
