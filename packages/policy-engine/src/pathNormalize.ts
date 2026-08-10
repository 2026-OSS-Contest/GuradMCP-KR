// Path normalization for FR-SEC-04 (GMCP-73, docs/task-docs/GMCP-73/FR-SEC-04-sensitive-file-block.md §3.1).
//
// `block_env_file_read` (Appendix A.1) matches `args.path_regex` against the
// raw path string a Tool Call carries. That string is attacker-controlled and
// trivially obfuscated (`../` traversal, percent-encoding, double-encoding,
// null-byte truncation, `~`/`$HOME` shorthand) — none of which the regex
// alone defeats. This module normalizes a path *before* `path_regex` sees it,
// mirroring the injection detector's own de-obfuscation principle
// (FR-INJ-02: repeated decode -> NFKC -> strip) applied to file paths.
//
// Everything here is string-level only: no filesystem access, no symlink
// resolution, no dependency on the server's actual `$HOME`. Where a shell
// expansion can't be safely resolved server-side, the spec calls for treating
// it conservatively (§3.1 step 4) rather than passing it through unexamined.

/** Result of {@link normalizePath}; `steps` is the audit trail of which transforms fired. */
export interface PathNormalizationResult {
  normalized: string;
  steps: string[];
}

/** Fields probed, in order, when extracting a path-like value from Tool Call args (spec §5.3). */
export const PATH_LIKE_KEYS = ["path", "file_path", "filename"] as const;

const MAX_DECODE_ITERATIONS = 3;
// eslint-disable-next-line no-control-regex -- intentionally matching control characters to strip them.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * Normalize a Tool Call path argument per spec §3.1's six-step pipeline:
 * repeated percent-decoding, NFKC, null-byte/control-char handling, `~`/`$HOME`
 * expansion, `.`/`..` segment resolution, then lowercasing.
 */
export function normalizePath(input: string): PathNormalizationResult {
  const steps: string[] = [];
  let value = input;

  value = decodeRepeatedly(value, steps);
  value = applyNfkc(value, steps);
  value = stripNullAndControl(value, steps);
  value = expandHomeReferences(value, steps);
  value = normalizeSegments(value, steps);
  value = toLowerCase(value, steps);

  return { normalized: value, steps };
}

/** First string value found among {@link PATH_LIKE_KEYS} in a Tool Call's args, if any (spec §5.3). */
export function extractPathArg(args: Record<string, unknown>): string | undefined {
  for (const key of PATH_LIKE_KEYS) {
    const candidate = args[key];
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

/** The final path segment of a normalized path, for basename-only matching (spec §3.2). */
export function basename(normalized: string): string {
  const segments = normalized.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1]! : normalized;
}

// --- Pipeline steps (spec §3.1, in order) -----------------------------------

/** Step 1 — percent-decode up to 3 times so double-encoding (`%252e...`) still resolves. */
function decodeRepeatedly(value: string, steps: string[]): string {
  let current = value;
  for (let iteration = 0; iteration < MAX_DECODE_ITERATIONS; iteration += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      break; // Malformed escape sequence: stop decoding, keep what we have.
    }
    if (decoded === current) break;
    current = decoded;
    steps.push(`percent-decode-${iteration + 1}`);
  }
  return current;
}

/** Step 2 — Unicode compatibility normalization (mirrors detect.ts's injection de-obfuscation). */
function applyNfkc(value: string, steps: string[]): string {
  const normalized = value.normalize("NFKC");
  if (normalized !== value) steps.push("nfkc");
  return normalized;
}

/**
 * Step 3 — a null byte truncates the string exactly as it would at the OS/libc
 * boundary (`id_rsa\0.png` resolves to the file `id_rsa`, not `id_rsa.png`,
 * which is precisely what this bypass variant relies on). Remaining control
 * characters and surrounding whitespace are stripped/trimmed so a trailing
 * space or tab can't dodge the `$`-anchored policy regex either.
 */
function stripNullAndControl(value: string, steps: string[]): string {
  const nullIndex = value.indexOf("\u0000");
  let current = value;
  if (nullIndex >= 0) {
    current = value.slice(0, nullIndex);
    steps.push("null-byte-truncate");
  }
  const stripped = current.replace(CONTROL_CHARS, "");
  if (stripped !== current) steps.push("control-char-strip");
  const trimmed = stripped.trim();
  if (trimmed !== stripped) steps.push("trim-whitespace");
  return trimmed;
}

/**
 * Step 4 — resolve `~`/`$HOME` shorthand as far as can be determined without
 * touching the real filesystem. The server doesn't know the caller's actual
 * home directory, so `~/x` and `$HOME/x` are treated as `/x` (root-relative)
 * rather than left unexamined — conservative in the sense that it still
 * exposes the trailing path for regex matching instead of passing the shell
 * shorthand through untouched.
 */
function expandHomeReferences(value: string, steps: string[]): string {
  if (value === "~" || value === "$HOME") {
    steps.push("home-expand-unresolvable");
    return "/";
  }
  if (value.startsWith("~/")) {
    steps.push("home-expand");
    return value.slice(1);
  }
  if (value.startsWith("$HOME/")) {
    steps.push("home-expand");
    return value.slice("$HOME".length);
  }
  return value;
}

/** Step 5 — resolve `.`/`..` segments textually (no filesystem access, no cwd dependency). */
function normalizeSegments(value: string, steps: string[]): string {
  const isAbsolute = value.startsWith("/");
  const resolved: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
        resolved.pop();
      } else if (!isAbsolute) {
        resolved.push("..");
      }
      // An absolute path can't traverse above root; a leading ".." there is dropped.
      continue;
    }
    resolved.push(segment);
  }
  const joined = (isAbsolute ? "/" : "") + resolved.join("/");
  const result = joined === "" ? "." : joined;
  if (result !== value) steps.push("path-normalize");
  return result;
}

/** Step 6 — lowercase for case-insensitive filename matching (`.ENV` -> `.env`). */
function toLowerCase(value: string, steps: string[]): string {
  const lower = value.toLowerCase();
  if (lower !== value) steps.push("lowercase");
  return lower;
}
