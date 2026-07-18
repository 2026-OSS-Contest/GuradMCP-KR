import { expect, it } from "vitest";
import { demoCustomers } from "./server.js";

it("keeps deterministic demo seed data", () => {
  expect(demoCustomers).toEqual([{ id: "C-001", name: "김가드", phone: "010-1234-5678", account: "계좌번호 110-123-456789" }]);
});
