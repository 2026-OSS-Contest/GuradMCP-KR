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
  }
  const totalFired = observations.reduce((sum, { firedLast30d }) => sum + firedLast30d, 0);
  if (totalFired === 0) {
    // The honest reading of all-zeros today: nothing is marked dry-run, so nothing was
    // observed. Reporting it as "0 false positives" would be a measurement nobody took.
    return {
      available: false,
      reason: "no policy is running in dry-run yet (GMCP-77), so there is no observed activity to report",
    };
  }
  return { available: true, source: baseUrl, window, policies: observations, totalFired };
}

function isStats(value: unknown): value is PolicyStatsResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.policyId === "string"
    && typeof record.window === "string"
    && typeof record.firedLast30d === "number"
    && (record.lastTriggeredAt === null || typeof record.lastTriggeredAt === "string");
}
