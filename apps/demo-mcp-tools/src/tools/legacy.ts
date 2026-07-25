import { rawContent, type ToolDefinition } from "../types.js";

/**
 * Pre-GMCP-19 stub tool, preserved verbatim. `docs/quickstart.md` and the
 * GMCP-30 CI readiness check (scripts/compose-readiness.sh, via demo-agent's
 * POST /demo/pii -> DemoAgentService.runPiiLookup()) both call this exact
 * tool through the gateway and assert the response masks to
 * [PHONE]/[BANK_ACCOUNT] with neither raw value left over. Do not rename,
 * remove, or change these values without updating both of those.
 */
const legacyCustomer = {
  id: "C-001",
  name: "김가드",
  phone: "010-1234-5678",
  account: "계좌번호 110-123-456789"
};

export const legacyTools: ToolDefinition[] = [
  {
    name: "customer_lookup",
    description: "Look up the fixed demo customer record used by the quickstart guide and CI readiness check.",
    inputSchema: { type: "object", properties: {} },
    handler: () => rawContent(legacyCustomer)
  }
];
