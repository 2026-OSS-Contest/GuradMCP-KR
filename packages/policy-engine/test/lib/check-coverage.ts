// Coverage gate for the Policy Unit Test Framework (GMCP-16, task spec §6).
//
// Fails the build when `policy-packs/default/policies/*.yaml` gains a policy
// that has no matching `test/fixtures/default/<policy-id>.cases.yaml`, so a
// new policy can never silently ship without a table-driven regression case.

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { loadPolicy } from "./load-cases.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

const policyFiles = globSync("policy-packs/default/policies/*.yaml", { cwd: repoRoot });
const caseFiles = globSync("test/fixtures/default/*.cases.yaml", { cwd: packageRoot });

const coveredIds = new Set<string>();
for (const relativeFile of caseFiles) {
  const raw = parse(readFileSync(path.join(packageRoot, relativeFile), "utf8")) as { policyId?: unknown };
  if (typeof raw?.policyId === "string") coveredIds.add(raw.policyId);
}

const missing = policyFiles
  .map((relativeFile) => loadPolicy(path.join(repoRoot, relativeFile)).id)
  .filter((id) => !coveredIds.has(id));

if (missing.length > 0) {
  console.error(`다음 default 팩 정책에 테스트 케이스가 없습니다: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`정책 커버리지 확인 완료: default 팩 정책 ${policyFiles.length}개 모두 케이스 파일이 있습니다.`);
