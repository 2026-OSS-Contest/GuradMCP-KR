// Regression for GMCP-26 review: send_email's subject/body are joined into one text before
// detection so a secret can't hide in `subject` alone (see server.test.ts's "catches a secret
// placed in `subject`" case), but a single detection can still straddle the join — the PEM
// private-key rule is written to match "across the full body" via `[\s\S]+?`, so a key whose
// BEGIN line lands in `subject` and END line lands in `body` produces exactly one detection
// spanning both fields. `resolveEmailFields` (server.ts) must recover this without ever
// searching the masked text for the separator, since the separator is itself inside the
// detected (and therefore replaced) span here. Lives in its own file for the same reason as
// `liveApproval.test.ts`: CONTROL_PLANE_URL is read once at server.ts's module load.
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
 *  second poll onward — just enough of Control Plane's contract for one end-to-end call. */
function fakeControlPlane(): Server {
  let createdId: string | undefined;
  let polls = 0;
  return createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.method === "POST" && request.url === "/api/v1/approvals") {
        createdId = "apr-straddle-1";
        response.statusCode = 201;
        response.end(JSON.stringify({ id: createdId, status: "pending" }));
        return;
      }
      if (request.method === "GET" && request.url === "/api/v1/approvals") {
        polls += 1;
        const resolved = polls > 1 && createdId;
        response.statusCode = 200;
        response.end(JSON.stringify(resolved ? [{ id: createdId, status: "approved_masked", decidedBy: "reviewer" }] : []));
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

describe("gateway end-to-end: a detection straddling the subject/body join (GMCP-26 review)", () => {
  it("masks both halves of a PEM key split across subject and body, and leaks neither raw half", async () => {
    process.env.CONTROL_PLANE_URL = await listen(fakeControlPlane());
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
    const subject = "See attached -----BEGIN RSA PRIVATE KEY-----";
    const body = "MIIBOgIBAAJBAKj3-----END RSA PRIVATE KEY----- please handle carefully";
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "send_email", arguments: { to: "outside@example.net", subject, body } }
      })
    });

    const result = (await response.json()) as { error?: unknown };
    expect(result.error).toBeUndefined();

    const upstreamArgs = JSON.parse(receivedBody) as { to: string; subject: string; body: string };
    expect(upstreamArgs.to).toBe("outside@example.net");
    // Each field kept its own untouched half and got the detection's label for its own share
    // of the match — neither field silently lost its half, and neither carries the other's text.
    expect(upstreamArgs.subject).toBe("See attached [PRIVATE_KEY]");
    expect(upstreamArgs.body).toBe("[PRIVATE_KEY] please handle carefully");
    expect(upstreamArgs.subject).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(upstreamArgs.body).not.toContain("END RSA PRIVATE KEY");
    expect(upstreamArgs.body).not.toContain("MIIBOgIBAAJBAKj3");
  });
});
