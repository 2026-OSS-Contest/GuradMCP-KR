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

/**
 * Unknown actions fail closed.
 *
 * The map is exhaustive over `GuardAction`, so the fallback only fires when the wire carries an
 * action this build has never heard of — the control plane growing its vocabulary ahead of the
 * console, which is exactly what happened with `warn` (GMCP-117). Falling back to 허용 was the
 * worst available answer: it tells the operator the call went through, which is the one claim a
 * console that does not recognise the verdict cannot support. 차단 overstates in the safe
 * direction and makes the drift visible instead of hiding it.
 */
export function toVerdict(action: GuardAction): Verdict {
  const known = VERDICT[action];
  if (known) return known;
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[verdict] unknown GuardAction "${action}" from the control plane — rendering as block`);
  }
  return "block";
}
