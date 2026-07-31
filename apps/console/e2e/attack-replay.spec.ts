import { expect, test } from "@playwright/test";

// GMCP-21 flow 1: 공격 실행 → 차단 표시 → Replay 확인.
//
// SCR-201 (Demo & Live Console, the screen that would trigger an attack scenario) is still a
// `ScreenStub` on this branch — there is no control in the DOM that "runs" an attack yet, so
// the 공격 실행 leg cannot be driven from the UI. This spec instead covers its observable
// effect end-to-end: a blocked event landing in SCR-101's recent-events feed (차단 표시) and
// deep-linking into the matching SCR-301 Replay detail (Replay 확인). The second test pins down
// the SCR-201 gap itself so it shows up as a needed follow-up rather than a silent omission.

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

test("GMCP-21 documents the gap: the attack-trigger screen (SCR-201) has no UI yet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "데모 실행" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText("SCR-201")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo & Live Console" })).toBeVisible();
  await expect(page.getByText(/스캐폴드 단계/)).toBeVisible();
});
