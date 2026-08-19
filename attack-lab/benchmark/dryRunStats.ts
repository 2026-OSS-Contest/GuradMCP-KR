// FR-LAB-03 (GMCP-31): the benchmark's view of dry-run policy activity.
//
// GMCP-77 runs policies in dry-run — recording the verdict they *would* have reached
// without applying it — so false positives can be counted against real traffic instead
// of only against this repository's synthetic negatives. Its acceptance criterion names
// this runner as the consumer, which is what this file is.
//
// Two things it refuses to do, both for the same reason:
//
//   - It never reports an FPR from these counts. `GET /policies/{id}/stats` answers how
//     often a policy fired; an FPR also needs how much benign traffic went past, and
//     that denominator does not exist in any shipped endpoint. Dividing by an assumed
//     one would put a number in a judge-facing report that nothing measured.
//   - It never reports zero as a result. Today the control plane answers
//     `firedLast30d: 0` for every dry-run query by construction — no policy is marked
//     dry-run yet — and "no policy fired" and "nothing was ever observed" are the same
//     JSON but opposite claims. Absence is reported as absence.
import type { Policy } from "../../packages/policy-engine/src/index.js";

export interface DryRunPolicyObservation {
  policyId: string;
  firedLast30d: number;
  lastTriggeredAt: string | null;
}

export type DryRunObservations =
  | { available: false; reason: string }
  | { available: true; source: string; window: string; policies: DryRunPolicyObservation[]; totalFired: number };

interface PolicyStatsResponse {
  policyId: string;
  window: string;
  firedLast30d: number;
  lastTriggeredAt: string | null;
  /**
   * Whether this policy is actually running in dry-run. Not in the contract today —
   * the control plane's `Policy` carries no such field — so it arrives undefined and
   * this pass reports an absence rather than inferring one. When GMCP-77 adds it,
   * reading it here is the only change needed.
   */
  dryRun?: boolean;
}

const window = "30d";

/**
 * Reads dry-run counts for every shipped policy. Returns `{ available: false }` — never
 * zeros — when the control plane is not configured, is unreachable, or has nothing to
 * report, so a report generated in CI (where neither exists) cannot be read as evidence
 * that no policy ever misfired.
 */
export async function readDryRunObservations(
  policies: Policy[],
  baseUrl = process.env.CONTROL_PLANE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<DryRunObservations> {
  if (!baseUrl) {
    return { available: false, reason: "CONTROL_PLANE_URL is not set; dry-run activity was not consulted" };
  }
  const observations: DryRunPolicyObservation[] = [];
  /** Set only by an explicit signal from the control plane, never inferred from counts. */
  let confirmedDryRun = false;
  for (const { id } of policies) {
    const url = `${baseUrl.replace(/\/$/, "")}/api/v1/policies/${encodeURIComponent(id)}/stats?window=${window}&dryRun=true`;
    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch {
      return { available: false, reason: `control plane at ${baseUrl} is unreachable` };
    }
    // A policy the control plane does not know is not a failure of this pass: the
    // benchmark ships policies the running instance may not have loaded.
    if (response.status === 404) continue;
    if (!response.ok) {
      return { available: false, reason: `control plane answered ${response.status} for policy stats` };
    }
    const body = (await response.json()) as PolicyStatsResponse;
    if (!isStats(body)) {
      return { available: false, reason: "control plane answered an unrecognized policy-stats shape" };
    }
    observations.push({
      policyId: body.policyId,
      firedLast30d: body.firedLast30d,
      lastTriggeredAt: body.lastTriggeredAt,
    });
    if (body.dryRun === true) confirmedDryRun = true;
  }
  const totalFired = observations.reduce((sum, { firedLast30d }) => sum + firedLast30d, 0);
  // A policy that fired under `dryRun=true` is itself proof that dry-run is running,
  // so activity needs no separate signal to be reportable.
  if (totalFired > 0 || confirmedDryRun) {
    return { available: true, source: baseUrl, window, policies: observations, totalFired };
  }
  // All zeros, and nothing said whether any policy is in dry-run. Two different worlds
  // produce this: no policy is in dry-run, or policies are and a clean period had no
  // false positives. The second is a real and good result that must not be thrown away
  // as "unobserved" — and this pass cannot tell them apart, so it says that instead of
  // picking one. Previously it asserted the first, which becomes wrong the moment
  // GMCP-77 turns dry-run on (GMCP-118).
  return {
    available: false,
    reason:
      "policy stats report no dry-run activity and the contract does not say which policies are in dry-run, "
      + "so zero fires cannot be told apart from no dry-run policies",
  };
}

function isStats(value: unknown): value is PolicyStatsResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.policyId === "string"
    && typeof record.window === "string"
    && typeof record.firedLast30d === "number"
    && (record.lastTriggeredAt === null || typeof record.lastTriggeredAt === "string")
    && (record.dryRun === undefined || typeof record.dryRun === "boolean");
}
