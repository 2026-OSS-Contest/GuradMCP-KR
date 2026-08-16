// T-05 Rug Pull, end-to-end demo (GMCP-65, FR-GW-03 §9 AC-1).
//
// A-09 in attack-lab/scenarios/catalog.json stays `automation.mode: "manual"` — it's a
// multi-step (approve → tamper → re-observe) flow the single-probe-vs-expected-result
// runner can't express (see catalog.json's own note on A-09). This script is the runnable
// version of that same flow against a live `docker compose up` stack:
//
//   1. Read the demo server's current tool definitions and approve them as the baseline —
//      the one step `POST /api/v1/servers/{id}/tool-snapshot/approve` genuinely requires an
//      operator/script to call; nothing auto-approves a server (spec §5.1.3).
//   2. Tamper one tool's description via demo-mcp-tools' `/tools/tamper` endpoint, simulating
//      the upstream server changing behavior after approval.
//   3. Call `tools/list` through the gateway, which detects the drift and emits a
//      `require_approval` GuardEvent (packages/gateway/src/server.ts's detectAndReportDrift).
//   4. Read the resulting diff back from the control plane.
//
// Reuses the gateway's own fingerprint function rather than reimplementing it — the whole
// point of keeping fingerprinting one-sided (packages/gateway/src/tool-snapshot.ts) is that
// nothing else ever recomputes it.
import { computeFingerprint, type ToolDefinitionLite } from "../../packages/gateway/src/tool-snapshot.js";

const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:3001";
const controlPlaneUrl = process.env.CONTROL_PLANE_URL ?? "http://localhost:8080";
const demoMcpToolsUrl = process.env.DEMO_MCP_TOOLS_URL ?? "http://localhost:3003";
// Matches docker-compose.yml's GATEWAY_SERVER_ID, the seeded file-server (DemoSeed.SERVER_FILE_ID).
const serverId = process.env.GATEWAY_SERVER_ID ?? "30000000-0000-4000-8000-000000000001";
const targetTool = "read_file";
const tamperedDescription = "파일 시스템 경로 또는 원격 URL에서 콘텐츠를 읽는다.";

async function main(): Promise<void> {
  log(`1/4 fetching current tool definitions from ${demoMcpToolsUrl}`);
  const { tools } = await getJson<{ tools: ToolDefinitionLite[] }>(`${demoMcpToolsUrl}/tools/list`);
  if (tools.length === 0) throw new Error("demo-mcp-tools reported no tools — is it running?");

  log(`2/4 approving the current definitions as the baseline for server ${serverId}`);
  const approveBody = {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      fingerprint: computeFingerprint(tool.description, tool.inputSchema),
    })),
    capturedBy: "attack-lab",
  };
  await postJson(`${controlPlaneUrl}/api/v1/servers/${serverId}/tool-snapshot/approve`, approveBody);
  log(`    baseline captured for ${tools.length} tools`);

  const before = tools.find((tool) => tool.name === targetTool)?.description;
  if (!before) throw new Error(`demo-mcp-tools has no tool named ${targetTool}`);

  log(`3/4 tampering '${targetTool}'s description (simulating an upstream Rug Pull)`);
  log(`    before: ${before}`);
  log(`    after:  ${tamperedDescription}`);
  await postJson(`${demoMcpToolsUrl}/tools/tamper`, { name: targetTool, description: tamperedDescription });

  log("4/4 calling tools/list through the gateway to trigger drift detection");
  // The gateway only compares against a baseline it has itself synced from the control plane
  // (TOOL_SNAPSHOT_SYNC_INTERVAL_MS, default 60s — see server.ts). If the gateway started
  // before step 2's approve call, its first observed baseline was "unapproved" and it won't
  // resync until that interval elapses, so retry rather than fail on the first miss. Set
  // TOOL_SNAPSHOT_SYNC_INTERVAL_MS=2000 (or similar) on the gateway before running this script
  // for a fast demo loop.
  type Diff = { diffType: string; before: unknown; after: unknown; detectedAt: string };
  let diffs: Diff[] = [];
  const attempts = 14;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await postJson(`${gatewayUrl}/mcp`, { jsonrpc: "2.0", id: "t05-demo", method: "tools/list" });
    const response = await getJson<{ diffs: Diff[] }>(`${controlPlaneUrl}/api/v1/servers/${serverId}/tools/${targetTool}/diffs`);
    diffs = response.diffs;
    if (diffs.length > 0) break;
    log(`    [${attempt}/${attempts}] no diff yet — gateway hasn't synced the new baseline; retrying in 5s`);
    await sleep(5_000);
  }
  if (diffs.length === 0) {
    throw new Error(
      "no diff was recorded after retrying — check that CONTROL_PLANE_URL was set when the gateway started and that it can reach the control plane",
    );
  }
  log("");
  log("Drift detected and recorded:");
  log(JSON.stringify(diffs, null, 2));
  log("");
  log(`Check the console's Gateway Home screen (SCR-101) — ${targetTool} on file-server should show a red "정의 변경 감지" badge.`);
  log(`Run with --reset afterward, or POST ${demoMcpToolsUrl}/tools/reset, to restore the original description.`);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return (await response.json()) as T;
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`POST ${url} -> ${response.status} ${text}`);
  }
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv.includes("--reset")) {
  await postJson(`${demoMcpToolsUrl}/tools/reset`, {});
  log("demo-mcp-tools tool definitions reset to their originals.");
} else {
  await main();
}
