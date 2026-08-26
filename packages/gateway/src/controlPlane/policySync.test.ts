import { PackRegistry } from "@guardmcp/policy-engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncPolicyRegistry } from "./policySync.js";

function fetchMockResolving(status = 200) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status }));
}

describe("syncPolicyRegistry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when no Control Plane base URL is configured", () => {
    const fetchMock = fetchMockResolving();
    vi.stubGlobal("fetch", fetchMock);

    syncPolicyRegistry(undefined, new PackRegistry([]), "some-token");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends no X-Sync-Token header when no token is configured", () => {
    const fetchMock = fetchMockResolving();
    vi.stubGlobal("fetch", fetchMock);

    syncPolicyRegistry("http://control-plane:8080", new PackRegistry([]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.has("X-Sync-Token")).toBe(false);
  });

  it("attaches the configured token as X-Sync-Token — the shared secret the Control Plane's security.sync-token checks", () => {
    const fetchMock = fetchMockResolving();
    vi.stubGlobal("fetch", fetchMock);

    syncPolicyRegistry("http://control-plane:8080", new PackRegistry([]), "test-sync-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Sync-Token")).toBe("test-sync-token");
  });
});
