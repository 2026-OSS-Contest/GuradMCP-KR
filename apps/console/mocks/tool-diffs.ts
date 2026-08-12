// FR-GW-03 §6.2/§6.3 fixtures. Keyed by "serverId:toolName" so `acknowledge` can mutate the
// same list `GET .../diffs` reads back, mirroring how `mocks/approvals.ts` keeps its own queue.

import type { ToolDefinitionDiff } from "@/lib/api/types";

const store = new Map<string, ToolDefinitionDiff[]>();

function key(serverId: string, toolName: string): string {
  return `${serverId}:${toolName}`;
}

/** Matches `SERVERS`'s `file-server` / `write_file` seed (`mocks/data.ts`), whose
 *  `snapshotStatus` is the `drift_detected` example straight from the spec's §6.2 sample. */
function seed(): Map<string, ToolDefinitionDiff[]> {
  const map = new Map<string, ToolDefinitionDiff[]>();
  map.set(key("file-server", "write_file"), [
    {
      id: "9f2b0000-0000-4000-8000-000000000001",
      diffType: "description_changed",
      before: { description: "파일 시스템에서 텍스트 파일을 쓴다." },
      after: { description: "파일 시스템 경로 또는 원격 URL에 콘텐츠를 쓴다." },
      detectedAt: "2026-08-02T03:00:00Z",
      acknowledged: false,
    },
  ]);
  return map;
}

export function resetToolDiffs(): void {
  store.clear();
  for (const [k, v] of seed()) store.set(k, v);
}

export function pendingDiffsOf(serverId: string, toolName: string): ToolDefinitionDiff[] {
  return (store.get(key(serverId, toolName)) ?? []).filter((diff) => !diff.acknowledged);
}

/** Returns the acknowledged diff, or `undefined` if no such pending diff exists (404). */
export function acknowledgeToolDiff(serverId: string, toolName: string, diffId: string): ToolDefinitionDiff | undefined {
  const diffs = store.get(key(serverId, toolName));
  const diff = diffs?.find((candidate) => candidate.id === diffId && !candidate.acknowledged);
  if (!diff) return undefined;
  diff.acknowledged = true;
  return diff;
}

resetToolDiffs();
