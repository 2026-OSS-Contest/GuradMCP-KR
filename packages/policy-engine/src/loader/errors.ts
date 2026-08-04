// Structured load-time error type (GMCP-14, FR-POL-02 §2).
//
// A malformed policy or pack manifest is never thrown as an exception; every
// loader function collects `PolicyLoadError`s instead so one bad file never
// stops the rest of the scan (file-level isolation, task spec §2).

export type PolicyLoadErrorLevel = "error" | "critical";

export interface PolicyLoadError {
  /** Path to the offending file, relative to the scanned root when known. */
  file: string;
  /** Which schema/scan rule was violated, e.g. `"action:invalid_value"`. */
  ruleId: string;
  /** Human-readable Korean message describing the violation. */
  message: string;
  /**
   * `"critical"` marks a failure inside a required pack (`default` /
   * `korean-pii`) so the caller (Gateway boot) can decide whether to
   * fail-closed; the loader itself never throws or exits.
   */
  level: PolicyLoadErrorLevel;
  line?: number;
  column?: number;
}

export function loadError(
  partial: Omit<PolicyLoadError, "line" | "column" | "level"> & {
    level?: PolicyLoadErrorLevel;
    line?: number;
    column?: number;
  }
): PolicyLoadError {
  const { line, column, level, ...rest } = partial;
  return {
    ...rest,
    level: level ?? "error",
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {})
  };
}
