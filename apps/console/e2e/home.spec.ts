import { expect, test } from "@playwright/test";

test("GMCP-30 console is reachable and points contributors to the policy guide", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Every tool call, inspected." })).toBeVisible();
  await expect(page.getByText("게이트웨이 보호 중")).toBeVisible();
  await expect(page.getByRole("link", { name: /정책 작성 가이드/ })).toHaveAttribute("href", /docs\/policy-guide/);
});

test("health endpoint reports readiness", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ status: "UP", service: "console" });
});
