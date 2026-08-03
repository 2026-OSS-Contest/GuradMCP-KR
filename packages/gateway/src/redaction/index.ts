// §2.1: `redact` is the only function this module exposes. Both the
// mask_then_allow execution path and the approval flow's "마스킹 후 승인"
// path call it directly; text extraction/reassembly stays with the caller.
export { redact } from "./redact.js";
export type {
  AppliedSpan,
  Detection,
  DetectionType,
  DiffSegment,
  MaskDiff,
  RedactionInput,
  RedactionOptions,
  RedactionResult
} from "./types.js";
