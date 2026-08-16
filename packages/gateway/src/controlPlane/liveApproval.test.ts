// End-to-end regression for GMCP-26 §5.1: with CONTROL_PLANE_URL configured, a send_email
// call carrying a secret is held for a real approval decision, and "마스킹 후 승인" delivers a
// masked body to a recipient/subject that were never touched. This has to live in its own file:
// `server.ts` reads CONTROL_PLANE_URL once at module load (routerDeps is a module-level
// singleton), and Vitest gives each test file its own module graph, so the env var only takes
// effect if it is set — via this file's own dynamic `import()`, below — before server.ts's
// static imports (and its own module-load-time read of the env var) run.
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

const servers: Server[] = [];

afterEach(async () => {
  delete process.env.DEMO_MCP_TOOLS_URL;
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("expected an AddressInfo");
      servers.push(server);
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

/** Answers `POST /approvals` with a pending id, then resolves it `approve_masked` from the
 *  second poll onward — just enough of Control Plane's contract for one end-to-end call.
 *  `onCreate`, when given, sees the parsed body of every `POST /api/v1/approvals` — this is
 *  how tests inspect what the gateway actually submitted as the Approval Card's `arguments`,
 *  mirroring the real Control Plane's `arguments: Map<String, String>?` deserialization: it
 *  rejects (400s) a request whose `arguments` carries a non-string value, exactly as
 *  `ApprovalController.kt` would. */
function fakeControlPlane(
  decidedBy: string,
  onCreate?: (body: Record<string, unknown>) => void,
): Server {
  let createdId: string | undefined;
  let polls = 0;
  return createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.method === "POST" && request.url === "/api/v1/approvals") {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        const args = parsed.arguments;
        const nonScalar =
          args !== null &&
          typeof args === "object" &&
          Object.values(args as Record<string, unknown>).some((value) => typeof value !== "string");
        if (nonScalar) {
          // What Spring would do trying to bind a non-string value into Map<String, String>.
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid arguments" }));
          return;
        }
        onCreate?.(parsed);
        createdId = "apr-live-1";
        response.statusCode = 201;
        response.end(JSON.stringify({ id: createdId, status: "pending" }));
        return;
      }
      if (request.method === "GET" && request.url === "/api/v1/approvals") {
        polls += 1;
        const resolved = polls > 1 && createdId;
        response.statusCode = 200;
        response.end(JSON.stringify(resolved ? [{ id: createdId, status: "approved_masked", decidedBy }] : []));
        return;
      }
      if (request.method === "POST" && request.url === "/api/v1/events") {
        response.statusCode = 201;
        response.end("{}");
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
  });
}

describe("gateway end-to-end with a live Control Plane approval backend (GMCP-26)", () => {
  it("delivers only the masked body upstream, with the recipient untouched, on approve_masked", async () => {
    const createdApprovals: Array<Record<string, unknown>> = [];
    process.env.CONTROL_PLANE_URL = await listen(
      fakeControlPlane("reviewer", (body) => createdApprovals.push(body)),
    );
    // Dynamic, so this runs after CONTROL_PLANE_URL is set — server.ts's routerDeps
    // (a module-level singleton) reads the env var exactly once, at this import.
    const { handler } = await import("../server.js");

    let receivedBody = "";
    const upstream = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/tools/call/send_email") {
        request.on("data", (chunk) => { receivedBody += chunk.toString(); });
        request.on("end", () => response.end(JSON.stringify({ status: "sent" })));
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
    process.env.DEMO_MCP_TOOLS_URL = await listen(upstream);

    const url = await listen(createServer(handler));
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "send_email",
          arguments: {
            to: "outside@example.net",
            subject: "Q3 report",
            body: "key sk-ant-demo0000000000000000demo",
            // Neither belongs on the Approval Card: `cc` is outside the to/subject allowlist,
            // and `attachment` is not even a string — if the gateway forwarded it as-is, the
            // fake Control Plane above would 400 it exactly as the real `Map<String, String>`
            // binding would, and this whole approval would fail closed to APPROVAL_TIMEOUT_BLOCKED.
            cc: ["someone@example.net"],
            attachment: { filename: "report.pdf" },
          },
        },
      })
    });

    const result = (await response.json()) as { error?: unknown };
    expect(result.error).toBeUndefined();

    // The card only ever saw an allowlisted, all-string `arguments` (GMCP-26 review) — proof
    // the approval was actually created (not silently rejected) with `cc`/`attachment` dropped.
    expect(createdApprovals).toHaveLength(1);
    expect(createdApprovals[0]?.arguments).toEqual({ to: "outside@example.net", subject: "Q3 report" });

    const upstreamArgs = JSON.parse(receivedBody) as { to: string; subject: string; body: string };
    expect(upstreamArgs.to).toBe("outside@example.net");
    expect(upstreamArgs.subject).toBe("Q3 report");
    expect(upstreamArgs.body).toBe("key [SECRET]");
    expect(upstreamArgs.body).not.toContain("sk-ant-demo0000000000000000demo");
  });
});
