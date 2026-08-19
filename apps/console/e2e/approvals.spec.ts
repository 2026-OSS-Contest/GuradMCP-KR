import { expect, test } from "@playwright/test";

// GMCP-21 flow 2: 승인 3택 처리 흐름 (approve / deny / mask).
//
// SCR-402 was a `ScreenStub` when this spec was written, so it could only check that the two
// entry points reached a scaffold. GMCP-50 built the console, so the flow can now be driven for
// real: each test enters the way an operator would and carries a held call to its decision.
// The console's own behaviour — the evidence on a card, the 120s timeout, the 409 a second
// operator hits — belongs to `approval.spec.ts`; this spec covers the route in, plus 그대로 승인,
// the one of the three decisions that spec does not already exercise.

test("GMCP-21 the status bar's pending badge opens the queue it counts", async ({ page }) => {
  await page.goto("/");
  const pending = page.getByRole("banner").getByRole("link", { name: /승인 대기 2/ });
  await expect(pending).toBeVisible();

  await pending.click();
  await expect(page).toHaveURL(/\/approvals$/);

  // The badge counted the calls this queue is holding, and both of them are on it. Asserted by
  // identity rather than count: the stream raises further calls while the page is open. Both are
  // `send_email` — the only tool the shipped packs can hold — so each is named by its recipient.
  await expect(page.getByRole("article").filter({ hasText: "dae-eun.jung@example.co.kr" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "newsletter@vendor.example" })).toBeVisible();
});

test("GMCP-21 rail nav reaches the console, where a call can be approved as it stands", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Approval" }).click();
  await expect(page).toHaveURL(/\/approvals$/);

  const card = page.getByRole("article").filter({ hasText: "dae-eun.jung@example.co.kr" });
  await card.getByRole("button", { name: /그대로 승인/ }).click();
  await expect(card).toBeHidden();

  // 처리 이력 names the decision that let it through, unmasked.
  await page.getByRole("button", { name: "처리 이력" }).click();
  await expect(page.getByRole("row").filter({ hasText: "send_email" }).getByText("그대로 승인")).toBeVisible();
});
