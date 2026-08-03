// GMCP-37 Redaction Engine — input/output contracts (spec §2, §5).
export type DetectionType = "PII" | "SECRET" | "INJECTION";

export interface Detection {
  type: DetectionType;
  /** e.g. "PHONE", "RRN_LIKE", "AWS_KEY" — 1:1 with the 부록 B tag catalog. */
  subtype: string;
  /** UTF-16 code unit offsets, half-open [start, end). */
  span: { start: number; end: number };
  confidence: number;
  /** The tag the detector proposed, e.g. "[PHONE]". */
  maskedAs: string;
}

export interface RedactionInput {
  text: string;
  detections: Detection[];
  options?: RedactionOptions;
}

export interface RedactionOptions {
  /** Detections below this confidence are excluded from masking. Default 0. */
  minConfidence?: number;
  /** When true, merged spans with mixed subtypes are tagged "[PHONE+BANK_ACCOUNT]". Default false. */
  annotateMergedTags?: boolean;
  /** Opt-in only (NFR-04 default false): keep the original text on the diff. */
  includeOriginalInDiff?: boolean;
}

export interface RedactionResult {
  maskedText: string;
  diff: MaskDiff;
  /** The merged spans actually applied; may be 1:N against the input detections. */
  appliedSpans: AppliedSpan[];
}

export interface AppliedSpan {
  /** Final merged span, in original-text coordinates. */
  span: { start: number; end: number };
  /** The detections that contributed to this span. */
  sourceDetections: Detection[];
  maskedAs: string;
}

export interface MaskDiff {
  /** NFR-04 default: original text is not included. Populated only when opted in. */
  original?: string;
  masked: string;
  segments: DiffSegment[];
  summary: {
    totalSpans: number;
    byType: Record<string, number>;
  };
}

export interface DiffSegment {
  kind: "plain" | "masked";
  /** Only set for "plain" segments; masked segments never carry original text. */
  text?: string;
  /** Only set for "masked" segments. */
  tag?: string;
  originalSpan?: { start: number; end: number };
  sourceTypes?: string[];
}
