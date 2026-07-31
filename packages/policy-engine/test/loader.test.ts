// Policy Pack Loader tests (GMCP-14, FR-POL-02).
// Acceptance criteria references (see docs/task-docs/GMCP-14/policy-pack-loader-task.md
// §수용 기준) are noted per `it` block.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolicyPacks } from "../src/index.js";

const fixturesRoot = fileURLToPath(new URL("./fixtures", import.meta.url));
const fixture = (name: string): string => resolve(fixturesRoot, name);

// The two 1st-class packs, loaded on their own so their pack/policy counts
// aren't diluted by the error-case fixtures loaded elsewhere in this file.
const HAPPY_PATH_ROOT = fixture("policy-packs");

describe("loadPolicyPacks", () => {
  it("loads the default and korean-pii fixture packs cleanly (AC1)", async () => {
    const registry = await loadPolicyPacks(HAPPY_PATH_ROOT);

    const defaultPack = registry.getPack("default");
    const koreanPiiPack = registry.getPack("korean-pii");

    expect(defaultPack?.enabled).toBe(true);
    expect(defaultPack?.errors).toEqual([]);
    expect(koreanPiiPack?.enabled).toBe(true);
    expect(koreanPiiPack?.errors).toEqual([]);
    expect(registry.getRootErrors()).toEqual([]);
  });

  it("sums policy counts from both fixture packs (AC2)", async () => {
    const registry = await loadPolicyPacks(HAPPY_PATH_ROOT);
    const defaultPack = registry.getPack("default");
    const koreanPiiPack = registry.getPack("korean-pii");

    // korean-pii's fixture includes one individually-disabled policy, so the
    // active count is 1 (default) + 1 (korean-pii's enabled policy) = 2.
    expect(defaultPack?.policies.length).toBe(1);
    expect(koreanPiiPack?.policies.length).toBe(2);
    expect(registry.getActivePolicyCount()).toBe(2);
  });

  it("rejects each broken policy with a file+line error while loading its valid sibling (AC3)", async () => {
    const registry = await loadPolicyPacks(fixture("invalid-pack-root"), { requiredPacks: [] });
    const pack = registry.getPack("invalid-pack");

    expect(pack).toBeDefined();
    // The one valid policy in the pack still loads despite its broken siblings.
    expect(pack?.policies.map((policy) => policy.id)).toEqual(["invalid_pack_valid_example"]);
    expect(pack?.errors.length).toBe(12);

    const badAction = pack?.errors.find((error) => error.file.endsWith("bad-action.yaml"));
    expect(badAction).toMatchObject({ line: 10, ruleId: "action:invalid_value" });
    expect(badAction?.message).toContain("blck");

    const missingPriority = pack?.errors.find(
      (error) => error.file.endsWith("missing-fields.yaml") && error.ruleId === "priority:invalid_type"
    );
    expect(missingPriority?.line).toBeDefined();

    const missingSeverity = pack?.errors.find(
      (error) => error.file.endsWith("missing-fields.yaml") && error.ruleId === "severity:invalid_value"
    );
    expect(missingSeverity?.line).toBeDefined();

    const badSyntax = pack?.errors.find((error) => error.file.endsWith("bad-syntax.yaml"));
    expect(badSyntax?.line).toBe(5);
    expect(badSyntax?.ruleId).toMatch(/^yaml:/);

    const outOfRange = pack?.errors.filter((error) => error.file.endsWith("out-of-range.yaml")) ?? [];
    expect(outOfRange.map((error) => error.ruleId).sort()).toEqual(["match.risk_score.gte:too_big", "priority:too_small"]);

    const unsafeRegex = pack?.errors.find((error) => error.file.endsWith("unsafe-regex.yaml"));
    expect(unsafeRegex?.ruleId).toBe("match.args.value_regex:unsafe_regex");

    const wrongType = pack?.errors.find((error) => error.file.endsWith("wrong-type.yaml"));
    expect(wrongType).toMatchObject({ ruleId: "priority:invalid_type" });
    expect(wrongType?.message).toContain("타입");

    const unknownField = pack?.errors.find((error) => error.file.endsWith("unknown-field.yaml"));
    expect(unknownField?.ruleId).toBe("unexpected_field:unrecognized_key");

    const missingApproval = pack?.errors.find((error) => error.file.endsWith("missing-approval.yaml"));
    expect(missingApproval?.ruleId).toBe("approval:custom");

    const mismatchedPack = pack?.errors.find((error) => error.file.endsWith("mismatched-pack.yaml"));
    expect(mismatchedPack?.ruleId).toBe("pack:mismatch");

    const notAnObject = pack?.errors.find((error) => error.file.endsWith("not-an-object.yaml"));
    expect(notAnObject?.ruleId).toBe("document:not_object");
  });

  it("rejects a manifest that lists a duplicate policy path and a missing file (load-time regex/manifest coverage)", async () => {
    const registry = await loadPolicyPacks(fixture("manifest-errors-root"), { requiredPacks: [] });
    const pack = registry.getPack("broken-manifest");

    expect(pack?.policies.map((policy) => policy.id)).toEqual(["broken_manifest_valid_example"]);
    expect(pack?.errors.map((error) => error.ruleId).sort()).toEqual([
      "manifest.policies:duplicate_entry",
      "manifest.policies:missing_file"
    ]);
  });

  it("rejects a duplicate policy id and keeps the first definition (AC4)", async () => {
    const registry = await loadPolicyPacks(fixture("duplicate-id-root"), { requiredPacks: [] });
    const pack = registry.getPack("duplicate-ids");

    expect(pack?.policies.map((policy) => policy.id)).toEqual(["dup_policy_id"]);
    expect(pack?.policies[0]?.priority).toBe(100); // the first-seen definition wins
    expect(pack?.errors).toHaveLength(1);
    expect(pack?.errors[0]).toMatchObject({ ruleId: "id:duplicate" });
    expect(pack?.errors[0]?.file).toMatch(/second\.yaml$/);
  });

  it("excludes a disabled pack's policies from the active set and count (AC5)", async () => {
    const registry = await loadPolicyPacks(HAPPY_PATH_ROOT);
    const before = registry.getActivePolicyCount();

    const disabled = registry.disablePack("korean-pii");

    expect(disabled).toBe(true);
    expect(registry.getActivePolicyCount()).toBe(before - 1);
    expect(registry.getActivePolicies().some((policy) => policy.pack === "korean-pii")).toBe(false);
    // The pack itself stays loaded (re-enabling should not require a re-scan).
    expect(registry.getPack("korean-pii")?.policies.length).toBe(2);

    registry.enablePack("korean-pii");
    expect(registry.getActivePolicyCount()).toBe(before);
  });

  it("excludes an individually-disabled policy from an otherwise-active pack (AC6)", async () => {
    const registry = await loadPolicyPacks(HAPPY_PATH_ROOT);
    const activeIds = registry.getActivePolicies().map((policy) => policy.id);

    expect(registry.getPack("korean-pii")?.enabled).toBe(true);
    expect(activeIds).not.toContain("korean_pii_disabled_example");
    expect(activeIds).toContain("mask_korean_pii_response");
  });

  it("returns an empty registry and a top-level error for a missing pack root (AC7)", async () => {
    const registry = await loadPolicyPacks(fixture("does-not-exist"));

    expect(registry.listPacks()).toEqual([]);
    expect(registry.getActivePolicyCount()).toBe(0);
    expect(registry.getRootErrors()).toHaveLength(1);
    expect(registry.getRootErrors()[0]).toMatchObject({ ruleId: "root:not_found", level: "critical" });
    expect(registry.getAllErrors()).toEqual(registry.getRootErrors());
  });

  it("escalates a required pack's own errors to critical instead of throwing", async () => {
    const registry = await loadPolicyPacks(fixture("critical-policy-packs"));
    const brokenDefault = registry.getPack("default");

    expect(brokenDefault?.errors.length).toBeGreaterThan(0);
    expect(brokenDefault?.errors.every((error) => error.level === "critical")).toBe(true);
    // Loading still completes — the loader signals, it never kills the process.
    expect(registry.getPack("korean-pii")?.errors).toEqual([]);
  });

  it("flags a missing required pack at the registry level as critical", async () => {
    const registry = await loadPolicyPacks(fixture("no-manifest-root"));

    const criticalRootErrors = registry.getRootErrors().filter((error) => error.ruleId === "required_pack:missing");
    expect(criticalRootErrors.map((error) => error.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("default"), expect.stringContaining("korean-pii")])
    );
    expect(criticalRootErrors.every((error) => error.level === "critical")).toBe(true);
  });

  it("falls back to the directory name and default_action:allow when a pack has no manifest", async () => {
    const registry = await loadPolicyPacks(fixture("no-manifest-root"), { requiredPacks: [] });
    const pack = registry.getPack("no-manifest-pack");

    expect(pack?.name).toBe("no-manifest-pack");
    expect(pack?.defaultAction).toBe("allow");
    expect(pack?.enabled).toBe(true);
    expect(pack?.policies.map((policy) => policy.id)).toEqual(["no_manifest_pack_policy"]);
  });

  it("builds a pack summary usable by the policy-packs tree view, including disabled packs", async () => {
    const registry = await loadPolicyPacks(HAPPY_PATH_ROOT);
    registry.disablePack("korean-pii");

    const summary = registry.getActivePackSummary();
    expect(summary).toEqual(
      expect.arrayContaining([
        { packId: "default", name: "default", policyCount: 1, enabled: true },
        { packId: "korean-pii", name: "korean-pii", policyCount: 2, enabled: false }
      ])
    );
  });

  it("loads the real repository policy-packs/ with default and korean-pii error-free", async () => {
    const repoRoot = fileURLToPath(new URL("../../../policy-packs", import.meta.url));
    const registry = await loadPolicyPacks(repoRoot);

    expect(registry.getPack("default")?.errors).toEqual([]);
    expect(registry.getPack("korean-pii")?.errors).toEqual([]);
    expect(registry.getRootErrors()).toEqual([]);
    expect(registry.getActivePolicyCount()).toBeGreaterThan(0);
  });
});
