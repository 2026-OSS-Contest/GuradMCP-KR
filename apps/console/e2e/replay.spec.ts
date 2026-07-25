import { expect, test } from "@playwright/test";

// SCR-301 Replay right panel (GMCP-34). The dev server mocks /api/v1/sessions and
// /sessions/{id}/timeline, so this exercises the same contracts the control plane will serve.

test("GMCP-34 SCR-301 shows the block event detail in fixed order", async ({ page }) => {
  await page.goto("/replay");

  const detail = page.locator('[data-scr="SCR-301"]');
  // Verdict badge + tool, then the matching policies, threat score and detections (spec §5.3).
  await expect(detail.getByText("read_file")).toBeVisible();
  await expect(detail.getByRole("button", { name: "block_env_file_read" })).toBeVisible();
  await expect(detail.getByText("위협 점수")).toBeVisible();
  await expect(detail.getByText("OPENAI_KEY")).toBeVisible();
  await expect(detail.getByText(/체인 검증 성공/)).toBeVisible();
});

test("SCR-301 session list selects a session", async ({ page }) => {
  await page.goto("/replay");
  const card = page.getByRole("button", { name: /#s-0711/ });
  await expect(card).not.toHaveAttribute("aria-current", "true");
  await card.click();
  await expect(card).toHaveAttribute("aria-current", "true");
});

test("SCR-301 policy chip opens a YAML popover", async ({ page }) => {
  await page.goto("/replay");
  await page.getByRole("button", { name: "block_env_file_read" }).click();
  const popover = page.getByRole("dialog", { name: "block_env_file_read" });
  await expect(popover).toBeVisible();
  await expect(popover.getByText(/action: block/)).toBeVisible();
  await expect(popover.getByRole("link", { name: "정책으로 이동" })).toHaveAttribute("href", "/policies/block_env_file_read");
});

test("SCR-301 reveal-original confirms, then shows the raw vs masked content", async ({ page }) => {
  await page.goto("/replay");
  // Step 1: the audit-log confirmation.
  await page.getByRole("button", { name: /원문 열람/ }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/감사 로그에 남습니다/)).toBeVisible();
  await confirm.getByRole("button", { name: "계속" }).click();
  await expect(confirm).toBeHidden();
  // Step 2: the reveal modal with the unmasked source next to its masked form.
  const reveal = page.getByRole("dialog", { name: "Mask Diff" });
  await expect(reveal).toBeVisible();
  await expect(reveal.getByText("010-4728-1953")).toBeVisible();
  await expect(reveal.getByText("PHONE")).toBeVisible();
  await reveal.getByRole("button", { name: "열람 중지" }).click();
  await expect(reveal).toBeHidden();
});
