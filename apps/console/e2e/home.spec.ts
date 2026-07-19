import { expect, test } from "@playwright/test";

test("GMCP-58 console shell renders the Gateway home with rail nav", async ({ page }) => {
  await page.goto("/");
  // SCR-101 Gateway home
  await expect(page.getByRole("heading", { name: "Gateway", level: 1 })).toBeVisible();
  // SCR-000 status bar (default locale ko)
  await expect(page.getByText("보호 중")).toBeVisible();
  // rail nav is present
  await expect(page.getByRole("link", { name: "Policies" })).toBeVisible();
});

test("rail nav navigates between SCR routes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Policies" }).click();
  await expect(page).toHaveURL(/\/policies$/);
  await expect(page.getByRole("heading", { name: "Policies", level: 1 })).toBeVisible();
});

test("health endpoint reports readiness", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ status: "UP", service: "console" });
});
