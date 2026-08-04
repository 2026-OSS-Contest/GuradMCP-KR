// Shared YAML + zod parsing plumbing (GMCP-14, FR-POL-02 §2).
//
// Both a policy file and a pack manifest go through the same pipeline:
// parse YAML with a `LineCounter` so every node keeps a source offset, run
// `doc.toJS()` through a zod schema, and — on failure — walk the failing
// issue's `path` back through the YAML `Document` to recover a line/column.
// A missing field has no YAML node of its own, so `locate` falls back to the
// nearest ancestor node that does exist (§3 of the design notes below).

import { LineCounter, parseDocument, type Document } from "yaml";
import type { ZodType } from "zod";
import { loadError, type PolicyLoadError } from "./errors.js";

export interface YamlValidationResult<T> {
  value?: T;
  errors: PolicyLoadError[];
}

export function parseYamlWithSchema<T>(text: string, filePath: string, schema: ZodType<T>): YamlValidationResult<T> {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, keepSourceTokens: true });

  if (doc.errors.length > 0) {
    return { errors: doc.errors.map((error) => ({
      file: filePath,
      ruleId: `yaml:${error.code}`,
      message: `YAML 구문 오류: ${error.message}`,
      level: "error",
      ...(error.linePos?.[0] ? { line: error.linePos[0].line, column: error.linePos[0].col } : {})
    })) };
  }

  const raw: unknown = doc.toJS();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      errors: [
        loadError({
          file: filePath,
          ruleId: "document:not_object",
          message: "YAML 문서는 객체(mapping)여야 합니다",
          ...locate(doc, lineCounter, [])
        })
      ]
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const record = raw as Record<string, unknown>;
    const errors = result.error.issues.flatMap((issue) => issueToErrors(doc, lineCounter, filePath, issue, record));
    return { errors };
  }

  return { value: result.data, errors: [] };
}

/**
 * Walk from the full field path up to the document root, returning the
 * line/column of the first YAML node that actually exists. A required field
 * that is entirely absent has no node at its own path — the loop falls back
 * to the parent (e.g. the `match:` mapping, or the whole document).
 */
function locate(doc: Document, lineCounter: LineCounter, path: (string | number)[]): { line?: number; column?: number } {
  for (let depth = path.length; depth >= 0; depth--) {
    const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
    const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
    if (range) {
      const pos = lineCounter.linePos(range[0]);
      return { line: pos.line, column: pos.col };
    }
  }
  return {};
}

interface ZodIssueLike {
  code: string;
  path: (string | number)[];
  message: string;
  expected?: string;
  values?: unknown[];
  minimum?: number;
  maximum?: number;
  inclusive?: boolean;
  keys?: string[];
}

function issueToErrors(
  doc: Document,
  lineCounter: LineCounter,
  filePath: string,
  rawIssue: unknown,
  raw: Record<string, unknown>
): PolicyLoadError[] {
  const issue = rawIssue as ZodIssueLike;
  const path = issue.path;

  if (issue.code === "unrecognized_keys" && issue.keys) {
    return issue.keys.map((key) => {
      const keyPath = [...path, key];
      const field = fieldName(keyPath);
      return loadError({
        file: filePath,
        ruleId: `${field}:unrecognized_key`,
        message: `알 수 없는 필드입니다: ${field}`,
        ...locate(doc, lineCounter, keyPath)
      });
    });
  }

  const field = fieldName(path);
  return [
    loadError({
      file: filePath,
      ruleId: `${field}:${issue.code}`,
      message: koreanMessage(issue, field, path, raw),
      ...locate(doc, lineCounter, path)
    })
  ];
}

function fieldName(path: (string | number)[]): string {
  return path.length > 0 ? path.join(".") : "root";
}

function koreanMessage(issue: ZodIssueLike, field: string, path: (string | number)[], raw: Record<string, unknown>): string {
  switch (issue.code) {
    case "invalid_type":
      return valueAt(raw, path) === undefined
        ? `${field} 필드가 필요합니다 (누락됨)`
        : `${field} 값의 타입이 올바르지 않습니다 (${issue.expected ?? "?"} 필요)`;
    case "invalid_value": {
      const actual = valueAt(raw, path);
      const options = Array.isArray(issue.values) ? issue.values.join("|") : "";
      return actual === undefined
        ? `${field} 필드가 필요합니다 (누락됨, ${options} 중 하나여야 함)`
        : `${field} 값 ${JSON.stringify(actual)}은(는) 허용되지 않습니다 (${options} 중 하나여야 함)`;
    }
    case "too_small":
      return `${field} 값이 허용 범위보다 작습니다 (최소 ${issue.minimum ?? "?"})`;
    case "too_big":
      return `${field} 값이 허용 범위보다 큽니다 (최대 ${issue.maximum ?? "?"})`;
    default:
      return issue.message || `${field} 값이 유효하지 않습니다`;
  }
}

function valueAt(raw: Record<string, unknown>, path: (string | number)[]): unknown {
  let current: unknown = raw;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}
