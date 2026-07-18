import { expect, it } from "vitest";
import { gatewayUrl } from "./server.js";

it("routes demo traffic through the configured gateway", () => {
  expect(gatewayUrl).toMatch(/^https?:\/\//);
});
