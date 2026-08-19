// FR-GW-03 §6.2/§6.3 fixtures. Keyed by "serverId:toolName" so `acknowledge` can mutate the
// same list `GET .../diffs` reads back, mirroring how `mocks/approvals.ts` keeps its own queue.

import type { ToolDefinitionDiff } from "@/lib/api/types";
import { minutesAgo } from "./demo-story";

const store = new Map<string, ToolDefinitionDiff[]>();

function key(serverId: string, toolName: string): string {
  return `${serverId}:${toolName}`;
}

/**
 * The two tools `mocks/demo-story.ts` marks as drifted, with the change that drifted them.
 *
 * `list_files`'s new description is the one `apps/demo-mcp-tools` actually ships ("List files and
 * directories under the sandbox root"), widened from what the baseline approved — the shape of a
 * Rug Pull, which is why this state exists at all (FR-GW-03 §6.2). The pair used to name
 * `write_file` and `list_tables`, neither of which is a tool on any server (GMCP-117).
 */
function seed(): Map<string, ToolDefinitionDiff[]> {
  const map = new Map<string, ToolDefinitionDiff[]>();
  map.set(key("file-server", "list_files"), [
    {
      id: "9f2b0000-0000-4000-8000-000000000001",
      diffType: "description_changed",
      before: { description: "샌드박스 루트 아래의 파일 목록을 조회한다." },
      after: { description: "샌드박스 루트 또는 연결된 원격 경로의 파일과 디렉터리 목록을 조회한다." },
      detectedAt: minutesAgo(12),
      acknowledged: false,
    },
  ]);
  map.set(key("db-server", "customer_lookup"), [
    {
      id: "9f2b0000-0000-4000-8000-000000000002",
      diffType: "description_changed",
      before: { description: "고객 한 명의 연락처를 조회한다." },
      after: { description: "고객 연락처를 조회한다. 필요하면 전체 목록도 함께 반환한다." },
      detectedAt: minutesAgo(60 * 26),
      acknowledged: true,
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

/** `includeAcknowledged=true` mirrors the real `?includeAcknowledged=true` query param —
 *  the only way the `drift_acknowledged` popover view has anything to show. */
export function allDiffsOf(serverId: string, toolName: string): ToolDefinitionDiff[] {
  return store.get(key(serverId, toolName)) ?? [];
}

/** Returns the acknowledged diff, or `undefined` if no such pending diff exists (404). */
export function acknowledgeToolDiff(serverId: string, toolName: string, diffId: string): ToolDefinitionDiff | undefined {
  const diffs = store.get(key(serverId, toolName));
  const diff = diffs?.find((candidate) => candidate.id === diffId && !candidate.acknowledged);
  if (!diff) return undefined;
  diff.acknowledged = true;
  return diff;
}

/** Mirrors `ToolSnapshotStore.reapprove`: a fresh baseline resolves every diff ever raised
 *  against the old one, so nothing is left pending — clear the tool's history outright rather
 *  than leaving stale acknowledged rows a later re-drift could be confused with. */
export function reapproveToolDiffs(serverId: string, toolName: string): void {
  store.delete(key(serverId, toolName));
}

resetToolDiffs();
