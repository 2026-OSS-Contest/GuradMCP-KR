import { expect, test } from "@playwright/test";

// SCR-301 Replay. The dev server mocks /api/v1/sessions, /sessions/{id}/timeline and
// /policies/{id}, so these exercise the same contracts the control plane will serve.
// The timeline and the detail panel share text (a tool name, a policy id), so detail
// assertions are scoped to the `event-detail` region and timeline ones to the `log`.

// ── GMCP-34 event detail ────────────────────────────────────────────────────

test("GMCP-34 SCR-301 shows the block event detail in fixed order", async ({ page }) => {
  await page.goto("/replay");
  const detail = page.getByTestId("event-detail");
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
  await page.getByTestId("event-detail").getByRole("button", { name: "block_env_file_read" }).click();
  const popover = page.getByRole("dialog", { name: "block_env_file_read" });
  await expect(popover).toBeVisible();
  await expect(popover.getByText(/action: block/)).toBeVisible();
  await expect(popover.getByRole("link", { name: "정책으로 이동" })).toHaveAttribute("href", "/policies/block_env_file_read");
});

test("SCR-301 reveal-original confirms, then shows the raw vs masked content", async ({ page }) => {
  await page.goto("/replay");
  // Step 1: the audit-log confirmation.
  await page.getByTestId("event-detail").getByRole("button", { name: /원문 열람/ }).click();
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

// ── GMCP-11 timeline ────────────────────────────────────────────────────────

test("GMCP-11 timeline renders the session nodes and playback controls", async ({ page }) => {
  await page.goto("/replay");
  const timeline = page.getByRole("log");
  await expect(timeline.getByText("README를 요약해줘")).toBeVisible();
  await expect(timeline.getByText('read_file(".env")')).toBeVisible();
  await expect(page.getByTestId("play-toggle")).toBeVisible();
  await expect(page.getByRole("button", { name: "1x", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /다음 판정/ })).toBeVisible();
});

test("clicking a timeline node swaps in that node's own detail", async ({ page }) => {
  await page.goto("/replay");
  const detail = page.getByTestId("event-detail");
  // Default selection is the block verdict — its threat score is on screen.
  await expect(detail.getByText("read_file")).toBeVisible();
  await expect(detail.getByText("위협 점수")).toBeVisible();
  // The user node reads differently: its own header, not a verdict breakdown.
  await page.getByRole("log").getByRole("button", { name: /README를 요약해줘/ }).click();
  await expect(detail.getByText("README를 요약해줘")).toBeVisible();
  await expect(detail.getByText("read_file")).toBeHidden();
  await expect(detail.getByText("위협 점수")).toBeHidden();
});

test("next-verdict jump selects the verdict node", async ({ page }) => {
  await page.goto("/replay");
  const log = page.getByRole("log");
  await log.getByRole("button", { name: /README를 요약해줘/ }).click();
  await page.getByRole("button", { name: /다음 판정/ }).click();
  await expect(log.getByRole("button", { name: /block_env_file_read/ })).toHaveAttribute("aria-current", "true");
});

test("play button toggles playback", async ({ page }) => {
  await page.goto("/replay");
  // Playback can only start once the timeline has loaded: with no events yet, the play
  // effect sees the playhead already at the end and stops itself. Wait for the rail first.
  await expect(page.getByRole("log").getByText("README를 요약해줘")).toBeVisible();
  const play = page.getByTestId("play-toggle");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
});
