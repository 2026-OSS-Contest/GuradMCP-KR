import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { readBulkPiiMinCount } from "./benchmark.js";
import type { Policy } from "../../packages/policy-engine/src/index.js";

const POLICY_ID = "require_approval_bulk_pii_response";
const POLICY_PATH = new URL(
  `../../policy-packs/korean-pii/policies/require-approval-bulk-pii-response.yaml`,
  import.meta.url,
);

function policyMap(policy: unknown): Map<string, Policy> {
  return new Map([[POLICY_ID, policy as Policy]]);
}

describe("bulk PII threshold sharing (GMCP-119, FR-LAB-03)", () => {
  it("reads the number the shipped policy actually enforces", async () => {
    const shipped = parse(await readFile(POLICY_PATH, "utf8")) as Policy;
    // The whole point: one number, read from the file that enforces it. A second
    // copy in the benchmark is how this metric ends up crediting a block at a count
    // the policy would not have escalated at.
    expect(readBulkPiiMinCount(policyMap(shipped))).toBe(shipped.match?.detections?.min_count);
  });

  it("fails loudly when the policy is missing rather than assuming a threshold", () => {
    expect(() => readBulkPiiMinCount(new Map())).toThrow(/not among the shipped policies/);
  });

  it("rejects a threshold that is not a usable count", () => {
    for (const minCount of [0, -1, 2.5, "10", null, undefined]) {
      expect(
        () => readBulkPiiMinCount(policyMap({ match: { detections: { min_count: minCount } } })),
        String(minCount),
      ).toThrow(/min_count/);
    }
  });
});
