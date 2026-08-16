import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createControlPlaneApprovalBackend } from "./approvalBackend.js";

const servers: Server[] = [];

afterEach(async () => {
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

/** A tiny stand-in for Control Plane's `POST /approvals` + `GET /approvals`. */
function fakeControlPlane(statusAfterFirstPoll: string | null) {
  let created: { id: string; sessionId: unknown; toolName: unknown; arguments: unknown; riskReason: unknown; policyId: unknown } | undefined;
  let polls = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.method === "POST" && request.url === "/api/v1/approvals") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const record = { id: "apr-1", ...body };
        created = record;
        response.statusCode = 201;
        response.end(JSON.stringify({ id: record.id, status: "pending" }));
        return;
      }
      if (request.method === "GET" && request.url === "/api/v1/approvals") {
        polls += 1;
        const status = polls > 1 && statusAfterFirstPoll ? statusAfterFirstPoll : "pending";
        response.statusCode = 200;
        response.end(JSON.stringify(created ? [{ id: created.id, status, decidedBy: status === "pending" ? null : "reviewer" }] : []));
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
  });
  return { server, get created() { return created; } };
}

const baseRequest = {
  eventRef: "evt-1",
  sessionId: "req-1",
  direction: "request" as const,
  toolName: "send_email",
  riskScore: 96,
  matchedPolicyIds: ["approve_external_email_with_secret"],
  policyId: "approve_external_email_with_secret",
  message: "External transmission is waiting for human approval.",
  arguments: { to: "outside@example.net" },
  riskTags: [{ type: "SECRET", count: 1 }],
  maskPreview: {
    raw: [{ no: "01", parts: [{ text: "key " }, { sensitive: "sk-ant-demo0000000000000000demo" }] }],
    masked: [{ no: "01", parts: [{ text: "key " }, { mask: "SECRET" }] }]
  }
};

describe("createControlPlaneApprovalBackend", () => {
  it("submits the approval with the card fields Control Plane's contract expects", async () => {
    const cp = fakeControlPlane("approved_masked");
    const url = await listen(cp.server);
    const backend = createControlPlaneApprovalBackend(url);

    await backend.submit(baseRequest);

    expect(cp.created).toMatchObject({
      sessionId: "req-1",
      toolName: "send_email",
      arguments: { to: "outside@example.net" },
      riskReason: "External transmission is waiting for human approval.",
      policyId: "approve_external_email_with_secret",
      riskTags: [{ type: "SECRET", count: 1 }],
      threatScore: 96,
      maskPreview: {
        raw: [{ no: "01", parts: [{ text: "key " }, { sensitive: "sk-ant-demo0000000000000000demo" }] }],
        masked: [{ no: "01", parts: [{ text: "key " }, { mask: "SECRET" }] }]
      }
    });
  });

  it("polls until a terminal status resolves, and passes through the real decider", async () => {
    const { server } = fakeControlPlane("approved_masked");
    const url = await listen(server);
    const backend = createControlPlaneApprovalBackend(url);

    const id = await backend.submit(baseRequest);
    const outcome = await backend.awaitDecision(id, 5_000);

    expect(outcome).toEqual({ decision: "approve_masked", decidedBy: "reviewer" });
  });

  it("maps a block/expired remote status straight through", async () => {
    const { server } = fakeControlPlane("blocked");
    const url = await listen(server);
    const backend = createControlPlaneApprovalBackend(url);

    const id = await backend.submit(baseRequest);
    const outcome = await backend.awaitDecision(id, 5_000);

    expect(outcome.decision).toBe("block");
  });

  it("maps Control Plane's own EXPIRED sweep (120s timeout) through, decidedBy and all", async () => {
    // Distinct from the "fails closed on the local deadline" case below: here Control Plane's
    // own scheduler already flipped the record before this backend's local deadline would have
    // fired, e.g. `system:timeout` — the poll branch has to win, not the local backstop.
    const { server } = fakeControlPlane("expired");
    const url = await listen(server);
    const backend = createControlPlaneApprovalBackend(url);

    const id = await backend.submit(baseRequest);
    const outcome = await backend.awaitDecision(id, 5_000);

    expect(outcome).toEqual({ decision: "expired", decidedBy: "reviewer" });
  });

  it("fails closed on the local deadline when Control Plane never resolves the request", async () => {
    const { server } = fakeControlPlane(null); // stays "pending" forever
    const url = await listen(server);
    const backend = createControlPlaneApprovalBackend(url);

    const id = await backend.submit(baseRequest);
    const outcome = await backend.awaitDecision(id, 150);

    expect(outcome).toEqual({ decision: "expired" });
  });

  it("fails closed immediately when Control Plane is unreachable at submit time (NFR-03)", async () => {
    // Nothing listening on this port.
    const backend = createControlPlaneApprovalBackend("http://127.0.0.1:1");

    const id = await backend.submit(baseRequest);
    const outcome = await backend.awaitDecision(id, 100_000);

    expect(outcome).toEqual({ decision: "expired" });
  });
});
