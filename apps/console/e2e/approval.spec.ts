import { expect, test } from "@playwright/test";

// SCR-402 Approval Console. `GET /approvals` and `POST /approvals/{id}/decision` are served by
// the control plane; MSW keeps its own queue so the 120s timeout and the 409 a second operator
// hits can both be exercised.

test("GMCP-50 SCR-402 lists the held calls with their evidence", async ({ page }) => {
  await page.goto("/approvals");

  await expect(page.getByRole("button", { name: /대기열/ })).toHaveAttribute("aria-current", "page");
  const card = page.getByRole("article").first();
  await expect(card.getByText("send_email")).toBeVisible();
  await expect(card.getByText("external@example.com")).toBeVisible();
  await expect(card.getByText("SECRET 1건")).toBeVisible();
  await expect(card.getByText("92")).toBeVisible();
  await expect(card.getByText("approve_external_email_with_secret")).toBeVisible();

  // The mask preview shows what would go out beside what would be sent instead.
  await expect(card.getByText("010-4728-1953")).toBeVisible();
  await expect(card.getByText("BANK_ACCOUNT")).toBeVisible();
});

test("SCR-402 approving masked moves the call into the history", async ({ page }) => {
  await page.goto("/approvals");
  const card = page.getByRole("article").filter({ hasText: "send_email" });
  await card.getByRole("button", { name: /마스킹 후 승인/ }).click();

  // It leaves the queue.
  await expect(card).toBeHidden();

  await page.getByRole("button", { name: "처리 이력" }).click();
  const row = page.getByRole("row").filter({ hasText: "send_email" });
  await expect(row.getByText("마스킹 후 승인")).toBeVisible();
  await expect(row.getByText("administrator")).toBeVisible();
});

test("SCR-402 the three decisions are available from the keyboard", async ({ page }) => {
  await page.goto("/approvals");
  await expect(page.getByRole("article").filter({ hasText: "send_email" })).toBeVisible();

  // B / M / A resolve the call at the top of the queue without reaching for the mouse (§5.6).
  await page.keyboard.press("b");
  await expect(page.getByRole("article").filter({ hasText: "send_email" })).toBeHidden();

  // M masks the next one, so both letters are covered against a stray remap.
  await expect(page.getByRole("article").filter({ hasText: "fetch_url" })).toBeVisible();
  await page.keyboard.press("m");
  await expect(page.getByRole("article").filter({ hasText: "fetch_url" })).toBeHidden();

  await page.getByRole("button", { name: "처리 이력" }).click();
  await expect(page.getByRole("row").filter({ hasText: "send_email" }).getByText("차단")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "fetch_url" }).getByText("마스킹 후 승인")).toBeVisible();
});

test("SCR-402 a call that runs out of time says so before it leaves", async ({ page }) => {
  await page.clock.install();
  await page.goto("/approvals");
  await expect(page.getByRole("article").first()).toBeVisible();

  // Past the 120s deadline the gateway has already failed the call closed, and the card says
  // which one it was rather than vanishing.
  await page.clock.fastForward("02:05");
  await expect(page.getByText(/시간 초과\(120s\)로 인한 차단/).first()).toBeVisible();
  await expect(page.getByText(/처리 이력으로 이동합니다/).first()).toBeVisible();
});

test("SCR-402 reports a call another operator already handled", async ({ page }) => {
  await page.goto("/approvals");
  await expect(page.getByRole("article").filter({ hasText: "send_email" })).toBeVisible();

  // Stand in for the other operator by resolving it straight through the API. It has to be this
  // page: MSW answers from the handler module of whichever page made the request, so a second
  // tab would keep its own queue and never conflict with this one.
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/v1/approvals/apr-1/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "block" })
    });
    return response.status;
  });
  expect(status).toBe(200);

  // The card is still on screen here, so deciding it now conflicts — 409, reported not retried.
  await page.getByRole("article").filter({ hasText: "send_email" }).getByRole("button", { name: /마스킹 후 승인/ }).click();
  await expect(page.getByText("다른 처리자가 이미 처리했습니다.")).toBeVisible();
});

test("SCR-402 says what to do when the gateway is unreachable", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("guardmcp.mock-scenario", "offline"));
  await page.goto("/approvals");
  await expect(page.getByText(/게이트웨이 연결을 확인한 뒤/)).toBeVisible();
});
