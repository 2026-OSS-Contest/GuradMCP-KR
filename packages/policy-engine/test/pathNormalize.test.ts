import { describe, expect, it } from "vitest";
import { basename, extractPathArg, normalizePath, PATH_LIKE_KEYS } from "../src/pathNormalize.js";

// --- FR-SEC-04 §4: the 5 required bypass variants, each must resolve to the
// credential filename the regex targets. -----------------------------------

describe("normalizePath — bypass variants (spec §4, DoD)", () => {
  it("resolves relative-path traversal (./config/../.env)", () => {
    expect(normalizePath("./config/../.env").normalized).toBe(".env");
  });

  it("resolves deeper traversal (a/b/../../.env)", () => {
    expect(normalizePath("a/b/../../.env").normalized).toBe(".env");
  });

  it("resolves a single percent-encoded path (%2e%65%6e%76 -> .env)", () => {
    expect(normalizePath("%2e%65%6e%76").normalized).toBe(".env");
  });

  it("resolves double percent-encoding within the 3-iteration budget", () => {
    expect(normalizePath("%252e%2565%256e%2576").normalized).toBe(".env");
  });

  it("truncates at a trailing null byte (id_rsa%00.png -> id_rsa)", () => {
    expect(normalizePath("id_rsa%00.png").normalized).toBe("id_rsa");
  });

  it("expands ~/ shorthand so the trailing filename is visible", () => {
    const { normalized } = normalizePath("~/credentials.json");
    expect(basename(normalized)).toBe("credentials.json");
  });
});

describe("normalizePath — benign paths are left resolvable, not mangled", () => {
  it("leaves an unrelated file's basename intact", () => {
    expect(basename(normalizePath("./config/settings.json").normalized)).toBe("settings.json");
  });

  it("does not fold a .env-prefixed filename into .env", () => {
    expect(normalizePath("environment.md").normalized).toBe("environment.md");
    expect(normalizePath("env_backup.txt").normalized).toBe("env_backup.txt");
  });
});

describe("normalizePath — individual pipeline steps", () => {
  it("decodes at most 3 rounds of percent-encoding", () => {
    // "e" percent-encoded 4 times over; 3 decode rounds land on "%65", one short of "e".
    const quadEncoded = "%25%32%35%25%33%32%25%33%35%25%32%35%25%33%33%25%33%36%25%32%35%25%33%33%25%33%35";
    expect(normalizePath(quadEncoded).normalized).toBe("%65");
  });

  it("stops decoding on a malformed escape instead of throwing", () => {
    expect(() => normalizePath("%zz")).not.toThrow();
  });

  it("applies NFKC compatibility normalization", () => {
    // U+FF0E (fullwidth full stop) NFKC-normalizes to U+002E ('.').
    expect(normalizePath("．env").normalized).toBe(".env");
  });

  it("strips non-null control characters anywhere in the string", () => {
    expect(normalizePath("id_rsa\t").normalized).toBe("id_rsa");
    expect(normalizePath("id_rsa").normalized).toBe("id_rsa");
  });

  it("trims trailing whitespace so the $-anchored policy regex still applies", () => {
    expect(normalizePath(".env ").normalized).toBe(".env");
  });

  it("treats a bare ~ or $HOME as root, not as a literal path segment", () => {
    expect(normalizePath("~").normalized).toBe("/");
    expect(normalizePath("$HOME").normalized).toBe("/");
  });

  it("expands $HOME/ shorthand", () => {
    expect(basename(normalizePath("$HOME/id_rsa").normalized)).toBe("id_rsa");
  });

  it("does not treat a mid-string ~ as home shorthand", () => {
    expect(normalizePath("a/~b").normalized).toBe("a/~b");
  });

  it("lowercases for case-insensitive filename matching", () => {
    expect(normalizePath(".ENV").normalized).toBe(".env");
  });

  it("keeps an absolute path anchored at root after traversal collapses", () => {
    expect(normalizePath("/workspace/../../../etc/passwd").normalized).toBe("/etc/passwd");
  });

  it("records which steps actually fired, for the audit trail (spec §3.1)", () => {
    const { steps } = normalizePath("./config/../.ENV");
    expect(steps).toContain("path-normalize");
    expect(steps).toContain("lowercase");
  });

  it("records no steps for an already-normal path", () => {
    expect(normalizePath("readme.md").steps).toEqual([]);
  });
});

describe("extractPathArg", () => {
  it("reads path first", () => {
    expect(extractPathArg({ path: "a", file_path: "b", filename: "c" })).toBe("a");
  });

  it("falls back to file_path then filename", () => {
    expect(extractPathArg({ file_path: "b", filename: "c" })).toBe("b");
    expect(extractPathArg({ filename: "c" })).toBe("c");
  });

  it("returns undefined when no path-like key is present", () => {
    expect(extractPathArg({ note: ".env" })).toBeUndefined();
  });

  it("ignores a non-string value at a path-like key", () => {
    expect(extractPathArg({ path: 123 })).toBeUndefined();
  });

  it("probes exactly the documented keys, in order", () => {
    expect(PATH_LIKE_KEYS).toEqual(["path", "file_path", "filename"]);
  });
});

describe("basename", () => {
  it("returns the last segment of a normalized path", () => {
    expect(basename("workspace/nested/.env")).toBe(".env");
  });

  it("returns the whole string when there is no separator", () => {
    expect(basename("id_rsa")).toBe("id_rsa");
  });

  it("handles a root-only path", () => {
    expect(basename("/")).toBe("/");
  });
});
