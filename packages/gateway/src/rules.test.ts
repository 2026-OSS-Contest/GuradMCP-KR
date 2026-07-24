import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The catalogs are the contributor-facing surface: a PII pattern can be added without
 * touching TypeScript. These checks keep a data-only pull request from shipping a rule
 * the detector would reject at start-up.
 */
const catalogNames = ["pii", "secret", "injection"] as const;
const knownValidators = ["luhn", "koreanRrn", "koreanBizNo"];
const declaredTypes: Record<(typeof catalogNames)[number], string> = {
  pii: "PII",
  secret: "SECRET",
  injection: "INJECTION"
};

describe.each(catalogNames)("%s rule catalog", (name) => {
  const catalog = loadCatalog(name);

  it("declares a versioned catalog of the expected detection type", () => {
    expect(catalog.version).toBe(1);
    expect(catalog.type).toBe(declaredTypes[name]);
    expect(catalog.rules.length).toBeGreaterThan(0);
  });

  it("gives every rule a unique subtype", () => {
    const subtypes = catalog.rules.map((rule) => asString(rule.subtype));
    expect(new Set(subtypes).size).toBe(subtypes.length);
    for (const subtype of subtypes) expect(subtype).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("keeps every rule loadable, documented, and maskable", () => {
    for (const rule of catalog.rules) {
      const label = `${String(catalog.type)}.${String(rule.subtype)}`;
      expect(asString(rule.description), `${label} description`).not.toHaveLength(0);
      expect(asString(rule.flags), `${label} flags`).toContain("g");
      expect(asString(rule.maskedAs), `${label} mask tag`).toMatch(/^\[[A-Z][A-Z0-9_]*\]$/);
      expect(() => new RegExp(asString(rule.pattern), asString(rule.flags)), `${label} pattern`).not.toThrow();
    }
  });

  it("only references validators the detector implements", () => {
    for (const rule of catalog.rules) {
      if (rule.validate === undefined) continue;
      expect(knownValidators).toContain(rule.validate);
    }
  });
});

function loadCatalog(name: string): { version: unknown; type: unknown; rules: Record<string, unknown>[] } {
  const parsed: unknown = JSON.parse(readFileSync(new URL(`./rules/${name}.json`, import.meta.url), "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.rules)) throw new Error(`${name}.json is not a rule catalog.`);
  return { version: parsed.version, type: parsed.type, rules: parsed.rules.map(asRecord) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Rule entry is not an object.");
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Rule field is not a string.");
  return value;
}
