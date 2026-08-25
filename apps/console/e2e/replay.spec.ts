import { expect, test, type Page } from "@playwright/test";

// SCR-301 Replay. The dev server mocks /api/v1/sessions, /sessions/{id}/timeline and
// /policies/{id}/source, so these exercise the same contracts the control plane will serve.
// The timeline and the detail panel share text (a tool name, a policy id), so detail
// assertions are scoped to the `event-detail` region and timeline ones to the `log`.

// ── GMCP-34 event detail ────────────────────────────────────────────────────

// The session opens on its first verdict — the README read, which the gateway allowed and
// recorded. The block is two nodes later, so the tests that want it select it.
const blockNode = (page: Page) =>
  page.getByRole("log").getByRole("button", { name: /block_env_file_read/ });

test("GMCP-34 SCR-301 shows the block event detail in fixed order", async ({ page }) => {
  await page.goto("/replay");
  await blockNode(page).click();
  const detail = page.getByTestId("event-detail");
  await expect(detail.getByText("read_file")).toBeVisible();
  await expect(detail.getByRole("button", { name: "block_env_file_read" })).toBeVisible();
  await expect(detail.getByText("위협 점수")).toBeVisible();
  await expect(detail.getByText("CREDENTIAL_FILE")).toBeVisible();
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
  await blockNode(page).click();
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
  await expect(reveal.getByText("010-3456-7890")).toBeVisible();
  await expect(reveal.getByText("PHONE")).toBeVisible();
  await reveal.getByRole("button", { name: "열람 중지" }).click();
  await expect(reveal).toBeHidden();
});

test("GMCP-84 §10.4: an account without events:reveal never sees the reveal button", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("guardmcp.operator-permissions", "denied"));
  await page.goto("/replay");
  await blockNode(page).click();
  await expect(page.getByTestId("event-detail").getByRole("button", { name: /원문 열람/ })).toHaveCount(0);
});

// ── GMCP-11 timeline ────────────────────────────────────────────────────────

test("GMCP-11 timeline renders the session nodes and playback controls", async ({ page }) => {
  await page.goto("/replay");
  const timeline = page.getByRole("log");
  await expect(timeline.getByText(/README 요약/)).toBeVisible();
  await expect(timeline.getByText('read_file(".env")')).toBeVisible();
  await expect(page.getByTestId("play-toggle")).toBeVisible();
  await expect(page.getByRole("button", { name: "1x", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /다음 판정/ })).toBeVisible();
});

test("clicking a timeline node swaps in that node's own detail", async ({ page }) => {
  await page.goto("/replay");
  const detail = page.getByTestId("event-detail");
  await blockNode(page).click();
  await expect(detail.getByText("read_file")).toBeVisible();
  await expect(detail.getByText("위협 점수")).toBeVisible();
  // The user node reads differently: its own header and 입력 원문, not a verdict breakdown.
  await page.getByRole("log").getByRole("button", { name: /README 요약/ }).first().click();
  await expect(detail.getByRole("heading", { name: "입력 원문" })).toBeVisible();
  await expect(detail.getByText(/README 요약/).first()).toBeVisible();
  await expect(detail.getByText("read_file")).toBeHidden();
  await expect(detail.getByText("위협 점수")).toBeHidden();
});

// ── GMCP-115: the per-node-type panel sections the design specifies ─────────

test("every timeline node renders its own design section, not a bare header", async ({ page }) => {
  await page.goto("/replay");
  const log = page.getByRole("log");
  const detail = page.getByTestId("event-detail");

  // Verdict node: Mask Diff, which never rendered before — `maskDiffRef` pointed at an endpoint
  // nothing implements.
  await blockNode(page).click();
  await expect(detail.getByRole("heading", { name: "Mask Diff" })).toBeVisible();
  await expect(detail.getByText("SECRET_LLM_API_KEY")).toBeVisible();

  // Agent node: its own report, and its title is its summary — not the neighbouring tool name.
  await log.getByRole("button", { name: /README 지시문에 따라/ }).click();
  await expect(detail.getByRole("heading", { name: "Agent 보고 요약" })).toBeVisible();
  await expect(detail.getByText("read_file")).toBeHidden();

  // Tool-call node: target, arguments and the request-direction verdict.
  await log.getByRole("button", { name: /read_file\(".env"\)/ }).click();
  await expect(detail.getByRole("heading", { name: "대상" })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "요청 방향 판정" })).toBeVisible();

  // Result node: returned data and the response-direction verdict.
  await log.getByRole("button", { name: /GuardBlockError 반환/ }).click();
  await expect(detail.getByRole("heading", { name: "반환 데이터 요약" })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "응답 방향 판정" })).toBeVisible();
});

test("next-verdict jump selects the verdict node", async ({ page }) => {
  await page.goto("/replay");
  const log = page.getByRole("log");
  await log.getByRole("button", { name: /README 요약/ }).first().click();
  await page.getByRole("button", { name: /다음 판정/ }).click();
  // The next verdict after the prompt is the README read the gateway allowed and recorded.
  await expect(log.getByRole("button", { name: /허용/ }).first()).toHaveAttribute("aria-current", "true");
});

test("play button toggles playback", async ({ page }) => {
  await page.goto("/replay");
  // Playback can only start once the timeline has loaded: with no events yet, the play
  // effect sees the playhead already at the end and stops itself. Wait for the rail first.
  await expect(page.getByRole("log").getByText(/README 요약/)).toBeVisible();
  const play = page.getByTestId("play-toggle");
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
});
