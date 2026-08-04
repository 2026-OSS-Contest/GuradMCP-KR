// zod schemas for policy files and pack manifests (GMCP-14, FR-POL-02 §2).
//
// These validate the plain JS value produced by `doc.toJS()`; they never see
// YAML source positions themselves. `parsePolicyFile.ts` is responsible for
// mapping a failing zod issue's `path` back to a YAML node and a line/column
// (via the `yaml` package's `LineCounter`).
//
// Every object schema is `.strict()` so an unknown field is a load error
// (task spec §2) rather than a silently ignored typo.

import { z } from "zod";
import { actions, reasonCodes, severities } from "../types.js";

const directionValues = ["request", "response", "any"] as const;
const serverTrustValues = ["trusted", "limited", "untrusted", "any"] as const;
const evaluationStrategyValues = ["severity-max", "first-match"] as const;

export const matchSchema = z
  .object({
    direction: z.enum(directionValues).optional(),
    tool: z.string().min(1).optional(),
    server_trust: z.enum(serverTrustValues).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    detections: z
      .object({
        any_of: z.array(z.string().min(1)).optional(),
        all_of: z.array(z.string().min(1)).optional(),
        none_of: z.array(z.string().min(1)).optional()
      })
      .strict()
      .optional(),
    risk_score: z
      .object({
        gte: z.number().min(0).max(100).optional(),
        lte: z.number().min(0).max(100).optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "match는 최소 하나 이상의 조건을 포함해야 합니다"
  });

export const approvalSchema = z
  .object({
    timeout_seconds: z.number().int().min(1).max(3600),
    on_timeout: z.literal("block"),
    allow_masked_approval: z.boolean().optional()
  })
  .strict();

export const policyFileSchema = z
  .object({
    id: z.string().min(1),
    pack: z.string().min(1),
    version: z.number().optional(),
    description: z.string().optional(),
    priority: z.number().int().min(0),
    match: matchSchema,
    action: z.enum(actions),
    severity: z.enum(severities),
    message: z.string().optional(),
    reasonCode: z.enum(reasonCodes).optional(),
    enabled: z.boolean().optional(),
    approval: approvalSchema.optional()
  })
  .strict()
  .refine((value) => value.action !== "require_approval" || value.approval !== undefined, {
    message: "action이 require_approval이면 approval 블록이 필요합니다",
    path: ["approval"]
  })
  .refine((value) => value.action === "require_approval" || value.approval === undefined, {
    message: "approval 블록은 action이 require_approval일 때만 사용할 수 있습니다",
    path: ["approval"]
  });

/**
 * `pack.yaml` / `pack.meta.yaml`. Every field is optional at the schema level
 * because a pack directory may have no manifest at all (task spec §1); the
 * loader supplies the documented defaults (`id` = directory name,
 * `default_action: allow`, `enabled: true`) when a field is absent.
 */
export const packManifestSchema = z
  .object({
    name: z.string().min(1).optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    dsl_version: z.number().optional(),
    default_action: z.enum(actions).optional(),
    evaluation_strategy: z.enum(evaluationStrategyValues).optional(),
    extends: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    policies: z.array(z.string()).optional()
  })
  .strict();

export type PolicyFileInput = z.infer<typeof policyFileSchema>;
export type PackManifestInput = z.infer<typeof packManifestSchema>;
