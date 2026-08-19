import { expect, test } from "@playwright/test";

// The dev server mocks `/api/v1/*` with MSW (see `mocks/`), so these run against the same
// endpoints the real control plane will serve.

test("GMCP-88 SCR-101 renders KPI cards, the inventory and recent events", async ({ page }) => {
  await page.goto("/");

  // KPI cards (spec §5.1 no.1)
  await expect(page.getByRole("link", { name: /MCP 서버/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /24h 차단/ })).toBeVisible();

  // Server inventory with connection state and trust tier (no.2)
  await expect(page.getByRole("heading", { name: "MCP 서버 인벤토리" })).toBeVisible();
  await expect(page.getByRole("button", { name: /file-server/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /db-server.*untrusted/ })).toBeVisible();

  // Recent events deep-link into the replay screen (no.5)
  await expect(page.getByRole("heading", { name: "최근 보안 이벤트" })).toBeVisible();
  await expect(page.getByRole("link", { name: /read_file/ }).first()).toHaveAttribute(
    "href",
    /\/replay\/[^/]+\?event=/
  );
});

test("SCR-101 inventory accordion reveals a server's tools", async ({ page }) => {
  await page.goto("/");

  const mailServer = page.getByRole("button", { name: /mail-server/ });
  await expect(mailServer).toHaveAttribute("aria-expanded", "false");

  await mailServer.click();
  await expect(mailServer).toHaveAttribute("aria-expanded", "true");
  // Scoped to the panel — `send_email` also appears in the recent-events list.
  await expect(page.locator("#inventory-tools-mail-server").getByText("send_email")).toBeVisible();
});

test("SCR-101 recent events grow from the mocked SSE stream", async ({ page }) => {
  await page.goto("/");
  // `role="log"` sits on the wrapper so the `<ul>` keeps its list semantics (GMCP-90).
  const rows = page.locator('[data-scr] [role="log"] ul > li');
  const seeded = await rows.count();
  // The mock pushes a guard.event every few seconds; the list should outgrow its seed.
  await expect(async () => expect(await rows.count()).toBeGreaterThan(seeded)).toPass({ timeout: 12_000 });
  // The freshest event sits at the top and deep-links into replay.
  await expect(rows.first().getByRole("link")).toHaveAttribute("href", /\/replay\/[^/]+\?event=/);
});

test("GMCP-86 recent events show the reconnect banner then recover", async ({ page }) => {
  await page.goto("/");
  const events = page.locator('[data-scr] section', { hasText: "최근 보안 이벤트" });
  await expect(events.getByRole("link").first()).toBeVisible();

  // Take the mocked gateway offline via the dev scenario switcher; the stream drops.
  await page.getByRole("button", { name: "Mock API 상태 전환" }).click();
  await page.getByRole("button", { name: /미연결/ }).click();
  await expect(events.getByText(/재연결 중/)).toBeVisible({ timeout: 10_000 });

  // Back online: the stream recovers, the banner clears and events are still listed (the
  // seeded list is never dropped, and recovery re-polls to backfill the gap).
  await page.getByRole("button", { name: /정상/ }).click();
  await expect(events.getByText(/재연결 중/)).toBeHidden({ timeout: 10_000 });
  await expect(events.getByRole("link").first()).toBeVisible();
});

test("SCR-000 status bar reports the gateway state", async ({ page }) => {
  await page.goto("/");
  // The gateway reports its own health, so one unreachable upstream still reads "보호 중";
  // the KPI card is what surfaces the disconnected server.
  await expect(page.getByText("보호 중")).toBeVisible();
  await expect(page.getByRole("link", { name: "Policies" })).toBeVisible();
});

test("rail nav navigates between SCR routes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Policies" }).click();
  await expect(page).toHaveURL(/\/policies$/);
  // SCR-302 carries no page title — none of the implemented screens do, only `ScreenStub` did —
  // so arriving is confirmed by the screen's own first pane having rendered.
  await expect(page.getByRole("region", { name: "정책팩" })).toBeVisible();
});

test("health endpoint reports readiness", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ status: "UP", service: "console" });
});
