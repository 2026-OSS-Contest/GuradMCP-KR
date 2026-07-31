import { expect, test } from "@playwright/test";

// SCR-201 Attack Lab. The dev server mocks `/attacklab/scenarios` and `/attacklab/run/{id}`
// (see `mocks/`), so these exercise the same contracts the control plane will serve once the
// Attack Lab runner (GMCP-55) executes the runs for real.

const UNGUARDED = "미적용 (GuardMCP 없음)";
const GUARDED = "적용 (GuardMCP 보호)";

test("GMCP-54 SCR-201 renders the picker, run controls and both panes", async ({ page }) => {
  await page.goto("/demo");

  // The picker settles on the first runnable scenario (spec §5.2 no.1).
  await expect(page.getByRole("button", { name: /T-01/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "미적용 실행" })).toBeVisible();
  await expect(page.getByRole("button", { name: "적용 실행", exact: true })).toBeVisible();

  // Sandbox notice, and the two result panes waiting for a run (no.3).
  await expect(page.getByText(/격리된 샌드박스에서 실행되며/)).toBeVisible();
  await expect(page.getByRole("region", { name: UNGUARDED })).toBeVisible();
  await expect(page.getByRole("region", { name: GUARDED })).toBeVisible();
});

test("SCR-201 a guarded run streams its tool calls and seals the outcome", async ({ page }) => {
  await page.goto("/demo");
  const pane = page.getByRole("region", { name: GUARDED });

  await page.getByRole("button", { name: "적용 실행", exact: true }).click();

  // The calls arrive as a stream, and the blocked one carries its reason and deciding policy.
  await expect(pane.getByText("block_env_file_read")).toBeVisible();
  await expect(pane.getByText(/민감 파일 경로에 대한 읽기 시도입니다/)).toBeVisible();

  // The seal stamps the outcome, and the summary strip links into the recorded session (no.4-5).
  await expect(pane.getByText("차단됨")).toBeVisible();
  await expect(pane.getByText(/차단 2건/)).toBeVisible();
  await expect(pane.getByRole("link", { name: /Replay에서 보기/ })).toHaveAttribute("href", "/replay/s-0712");
});

test("SCR-201 an unguarded run lets every call through and seals it as leaked", async ({ page }) => {
  await page.goto("/demo");
  const pane = page.getByRole("region", { name: UNGUARDED });

  await page.getByRole("button", { name: "미적용 실행" }).click();

  await expect(pane.getByText("유출 발생")).toBeVisible();
  // Nothing was stopped: the same calls ran with no verdict against them.
  await expect(pane.getByText(/차단 0건/)).toBeVisible();
  await expect(pane.getByText("block_env_file_read")).toBeHidden();
});

test("SCR-201 only one run is in flight at a time", async ({ page }) => {
  await page.goto("/demo");
  const other = page.getByRole("button", { name: "미적용 실행" });

  await page.getByRole("button", { name: "적용 실행", exact: true }).click();
  // The other mode locks while the run plays out, so the panes cannot disagree (no.2).
  await expect(other).toBeDisabled();
  await expect(page.getByRole("region", { name: GUARDED }).getByText("차단됨")).toBeVisible();
  await expect(other).toBeEnabled();
});

test("SCR-201 scenarios the runner does not cover yet are listed but not selectable", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: /T-01/ }).click();

  const list = page.getByRole("listbox", { name: "공격 시나리오를 선택하세요" });
  const pending = list.getByRole("option", { name: /T-03/ });
  await expect(pending).toHaveAttribute("aria-disabled", "true");
  await expect(pending.getByText("준비 중")).toBeVisible();

  // Choosing a runnable scenario swaps the header and clears the panes for it.
  await list.getByRole("option", { name: /T-08/ }).click();
  await expect(page.getByRole("button", { name: /T-08/ })).toBeVisible();
  await expect(page.getByRole("region", { name: GUARDED }).getByText(/실행 버튼을 누르면/)).toBeVisible();
});
