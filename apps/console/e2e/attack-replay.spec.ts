import { expect, test } from "@playwright/test";

// GMCP-21 flow 1: 공격 실행 → 차단 표시 → Replay 확인.
//
// The first test covers the flow's observable effect: a blocked event landing in SCR-101's
// recent-events feed (차단 표시) and deep-linking into the matching SCR-301 Replay detail
// (Replay 확인). The second drives the 공격 실행 leg itself, which SCR-201 (Attack Lab) can now
// do — it used to be a `ScreenStub`, so a second test pinned that gap down instead.

test("GMCP-21 a blocked event on the home page deep-links into its Replay detail", async ({ page }) => {
  await page.goto("/");

  const events = page.locator('[data-scr] section', { hasText: "최근 보안 이벤트" });
  const blocked = events.getByRole("link", { name: /read_file.*\.env/ });
  await expect(blocked).toBeVisible();

  await blocked.click();
  await expect(page).toHaveURL(/\/replay\/s-0712\?event=evt-6012$/);

  // The session named in the deep link is auto-selected … (anchored: the status bar's own
  // "세션 #s-0712" picker button would otherwise also match).
  await expect(page.getByRole("button", { name: /^#s-0712/ })).toHaveAttribute("aria-current", "true");

  // … and its detail panel shows the same block verdict the home row promised.
  const detail = page.getByTestId("event-detail");
  await expect(detail.getByText("read_file")).toBeVisible();
  await expect(detail.getByRole("button", { name: "block_env_file_read" })).toBeVisible();
  await expect(detail.getByText("위협 점수")).toBeVisible();
});

test("GMCP-21 running an attack on SCR-201 shows the block and leads to its Replay", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "데모 실행" }).click();
  await expect(page).toHaveURL(/\/demo$/);

  // 공격 실행: pick a scenario and run it through the guard.
  await page.getByRole("button", { name: "시나리오 선택" }).click();
  await page.getByRole("option", { name: /T-01/ }).click();
  await page.getByRole("button", { name: "적용 실행", exact: true }).click();

  // 차단 표시: the guarded pane names the policy that stopped the call.
  const guarded = page.getByRole("region", { name: "적용 (Guarded)" });
  await expect(guarded.getByText("block_env_file_read")).toBeVisible();

  // Replay 확인: the run's summary strip leads to the session it was recorded in.
  await page.getByRole("link", { name: /Replay에서 보기/ }).click();
  await expect(page).toHaveURL(/\/replay\/s-0712$/);
  await expect(page.getByTestId("event-detail").getByText("read_file")).toBeVisible();
});
