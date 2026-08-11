import type { DetectionFinding } from "@/lib/api/types";

/**
 * What a finding is called, and what kind of thing it turned out to be.
 *
 * The control plane reports a policy id, an action, a severity and the run of text that matched —
 * no detector label and no subtype (`DetectionFinding` in
 * `services/control-plane/.../domain/DetectionPreviewService.kt`). Both are recoverable from what
 * it does send: the detector that fired says which family a finding belongs to, and the matched
 * text's own shape says which member of that family it is. Deriving them here fills the spec's
 * §5.5 columns against a real gateway, with no API change and nothing invented — every answer
 * below is read out of the matched text itself.
 */

/** Fallback labels for a control plane that reports a policy id but no detector label. */
const TYPE_BY_POLICY: Record<string, string> = {
  mask_korean_phone: "PHONE",
  mask_korean_rrn: "RRN",
  mask_secret_token: "SECRET",
  block_env_file_read: "PATH",
  approve_external_email: "EMAIL"
};

export function labelOf(finding: DetectionFinding): string {
  return finding.type ?? TYPE_BY_POLICY[finding.policyId] ?? finding.policyId.toUpperCase();
}

/** Credential formats are self-identifying: the issuer picks the prefix precisely so tools can tell. */
const SECRET_ISSUERS: [RegExp, string][] = [
  [/^sk-/, "OPENAI"],
  [/^gh[pousr]_/, "GITHUB"],
  [/^AKIA/, "AWS"],
  [/^xox[baprs]-/, "SLACK"]
];

/** Which secret a sensitive path leads to — the reason the read was worth blocking. */
const PATH_KINDS: [RegExp, string][] = [
  [/\.env(\.\w+)?$/, "DOTENV"],
  [/id_rsa$/, "SSH_KEY"],
  [/credentials(\.json)?$/, "CREDENTIALS"]
];

function firstMatch(rules: [RegExp, string][], text: string): string | undefined {
  return rules.find(([pattern]) => pattern.test(text))?.[1];
}

/**
 * The finding's subtype, or `undefined` when there is nothing further to say.
 *
 * PHONE, RRN and EMAIL deliberately return nothing. A Korean mobile prefix stopped identifying a
 * carrier when number portability arrived, so any carrier here would be a guess. An e-mail's
 * domain is already the visible half of the address beside it. And a resident number's seventh
 * digit encodes birth era, nationality and sex — a console that exists to keep that value hidden
 * should not be decoding more of it than the operator asked to see.
 */
export function subtypeOf(finding: DetectionFinding): string | undefined {
  switch (labelOf(finding)) {
    case "SECRET":
      return firstMatch(SECRET_ISSUERS, finding.matchedText);
    case "PATH":
      return firstMatch(PATH_KINDS, finding.matchedText);
    default:
      return undefined;
  }
}
