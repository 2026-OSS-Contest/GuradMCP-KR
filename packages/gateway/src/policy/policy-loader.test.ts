// FR-POL-03 §6 step 3: boot and reload share the same underlying scan (`loadPolicyPacks`) but
// apply different pass/fail thresholds — see the header comment in policy-loader.ts.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasCriticalError,
  loadBootSnapshot,
  loadPolicySnapshot,
  resetPolicyVersionCounter
} from "./policy-loader.js";

async function writePack(root: string, packId: string, policyYaml: string | null): Promise<void> {
  const packDir = join(root, packId);
  await mkdir(join(packDir, "policies"), { recursive: true });
  await writeFile(
    join(packDir, "pack.yaml"),
    `name: ${packId}\nversion: 1.0.0\ndsl_version: 1\ndefault_action: allow\nevaluation_strategy: severity-max\nextends: []\npolicies:\n  - policies/p.yaml\n`
  );
  if (policyYaml !== null) await writeFile(join(packDir, "policies", "p.yaml"), policyYaml);
}

const VALID_POLICY =
  "id: block_env\npack: PACKID\npriority: 100\nmatch:\n  direction: request\n  tool: read_file\naction: block\nseverity: critical\n";

describe("policy-loader", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "policy-loader-test-"));
    resetPolicyVersionCounter();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("loadBootSnapshot", () => {
    it("is not fatal and returns a usable snapshot for a clean tree", async () => {
      await writePack(root, "default", VALID_POLICY.replace("PACKID", "default"));

      const result = await loadBootSnapshot(root, { requiredPacks: ["default"] });

      expect(result.fatal).toBe(false);
      expect(result.snapshot.registry.getPack("default")?.errors).toEqual([]);
      expect(result.snapshot.registry.getActivePolicyCount()).toBe(1);
    });

    it("is fatal when a required pack is missing (§6 step 3: boot must fail-closed)", async () => {
      // No packs written at all.
      const result = await loadBootSnapshot(root, { requiredPacks: ["default"] });

      expect(result.fatal).toBe(true);
      expect(hasCriticalError(result.registry)).toBe(true);
    });

    it("tolerates a non-critical error in a non-required pack (matches the pre-hot-reload CLI/lint tolerance)", async () => {
      await writePack(root, "default", VALID_POLICY.replace("PACKID", "default"));
      await writePack(root, "extra", "id: bad\npack: extra\naction: blck\n");

      const result = await loadBootSnapshot(root, { requiredPacks: ["default"] });

      expect(result.fatal).toBe(false);
      expect(result.snapshot.registry.getPack("extra")?.errors.length).toBeGreaterThan(0);
      expect(result.snapshot.registry.getPack("default")?.errors).toEqual([]);
    });
  });

  describe("loadPolicySnapshot (hot-reload path)", () => {
    it("succeeds with a snapshot for a clean tree", async () => {
      await writePack(root, "default", VALID_POLICY.replace("PACKID", "default"));

      const result = await loadPolicySnapshot(root, { requiredPacks: ["default"] });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.snapshot.version).toBe("1");
    });

    it("refuses to produce a snapshot when any error is present, even a non-critical one (§4.4)", async () => {
      await writePack(root, "default", VALID_POLICY.replace("PACKID", "default"));
      await writePack(root, "extra", "id: bad\npack: extra\naction: blck\n");

      const result = await loadPolicySnapshot(root, { requiredPacks: ["default"] });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.registry.getAllErrors().length).toBeGreaterThan(0);
    });

    it("increments version on each successful load", async () => {
      await writePack(root, "default", VALID_POLICY.replace("PACKID", "default"));

      const first = await loadPolicySnapshot(root, { requiredPacks: ["default"] });
      const second = await loadPolicySnapshot(root, { requiredPacks: ["default"] });

      if (!first.ok || !second.ok) throw new Error("unreachable");
      expect(first.snapshot.version).toBe("1");
      expect(second.snapshot.version).toBe("2");
    });
  });
});
