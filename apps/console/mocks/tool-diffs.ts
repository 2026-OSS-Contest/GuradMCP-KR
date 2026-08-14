// FR-GW-03 §6.2/§6.3 fixtures. Keyed by "serverId:toolName" so `acknowledge` can mutate the
// same list `GET .../diffs` reads back, mirroring how `mocks/approvals.ts` keeps its own queue.

import type { ToolDefinitionDiff } from "@/lib/api/types";

const store = new Map<string, ToolDefinitionDiff[]>();

function key(serverId: string, toolName: string): string {
  return `${serverId}:${toolName}`;
}

/** Matches `SERVERS`'s `file-server` / `write_file` seed (`mocks/data.ts`), whose
 *  `snapshotStatus` is the `drift_detected` example straight from the spec's §6.2 sample, and
 *  `mail-server` / `delete_message`'s `drift_acknowledged` example. */
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
  map.set(key("mail-server", "delete_message"), [
    {
      id: "9f2b0000-0000-4000-8000-000000000002",
      diffType: "description_changed",
      before: { description: "받은 메일함에서 메시지를 삭제한다." },
      after: { description: "받은 메일함 또는 보관함에서 메시지를 영구 삭제한다." },
      detectedAt: "2026-07-30T03:00:00Z",
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
