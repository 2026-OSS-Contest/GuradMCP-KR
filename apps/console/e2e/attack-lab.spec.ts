import { expect, test } from "@playwright/test";

// SCR-201 Attack Lab. The dev server mocks `/attacklab/scenarios` and `/attacklab/run/{id}`
// (see `mocks/`), so these exercise the same contracts the control plane will serve once the
// Attack Lab runner (GMCP-55) executes the runs for real.

const UNGUARDED = "미적용 (Vulnerable)";
const GUARDED = "적용 (Guarded)";

/** Opens the picker and chooses a runnable scenario. */
async function pick(page: import("@playwright/test").Page, id: string) {
  await page.getByRole("button", { name: /시나리오 선택|T-0/ }).click();
  await page.getByRole("option", { name: new RegExp(id) }).click();
}

test("GMCP-54 SCR-201 opens on the waiting state", async ({ page }) => {
  await page.goto("/demo");

  // Nothing chosen yet, so neither run can start (spec §5.2 대기).
  await expect(page.getByRole("button", { name: "시나리오 선택" })).toBeVisible();
  await expect(page.getByRole("button", { name: "미적용 실행" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "적용 실행", exact: true })).toBeDisabled();

  // Both panes invite a run, the summary reads as dashes and the stream has no rows.
  await expect(page.getByRole("region", { name: UNGUARDED }).getByText("시나리오를 선택하고 실행하세요")).toBeVisible();
  await expect(page.getByRole("region", { name: GUARDED }).getByText("시나리오를 선택하고 실행하세요")).toBeVisible();
  await expect(page.getByText("결과 요약")).toBeVisible();
  await expect(page.getByRole("region", { name: "실시간 스트림" }).getByText("데이터가 없습니다.")).toBeVisible();

  // The sandbox notice states the unguarded run never touches anything real.
  await expect(page.getByText(/격리 샌드박스\(가짜 \.env, 가짜 SMTP\)/)).toBeVisible();
});

test("SCR-201 lists T-01…T-08 and refuses the ones the runner does not cover", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "시나리오 선택" }).click();

  const list = page.getByRole("listbox", { name: "시나리오 선택" });
  await expect(list.getByRole("option")).toHaveCount(8);
  await expect(list.getByRole("option", { name: /T-01.*악성 README/ })).toHaveAttribute("aria-disabled", "false");

  const pending = list.getByRole("option", { name: /T-06/ });
  await expect(pending).toHaveAttribute("aria-disabled", "true");
  await expect(pending.getByText("준비 중")).toBeVisible();
});

test("SCR-201 a guarded run shows the verdict, policy, risk score and the broken chain", async ({ page }) => {
  await page.goto("/demo");
  await pick(page, "T-01");
  const pane = page.getByRole("region", { name: GUARDED });

  await page.getByRole("button", { name: "적용 실행", exact: true }).click();

  // The blocked call carries its deciding policy and risk score.
  await expect(pane.getByText("block_env_file_read")).toBeVisible();
  await expect(pane.getByText("위험 점수")).toBeVisible();
  await expect(pane.getByText("92")).toBeVisible();
  // The follow-up call was never made, because the chain stopped at the block.
  await expect(pane.getByText(/호출 안 됨 – 선행 호출 차단으로 체인 중단/)).toBeVisible();
  // The pane reports where the calls went.
  await expect(pane.getByText("GuardMCP 경유")).toBeVisible();
});

test("SCR-201 an unguarded run exposes the payload it leaked", async ({ page }) => {
  await page.goto("/demo");
  await pick(page, "T-01");
  const pane = page.getByRole("region", { name: UNGUARDED });

  await page.getByRole("button", { name: "미적용 실행" }).click();

  await expect(pane.getByText("실행됨 · 토큰 노출")).toBeVisible();
  await expect(pane.getByText("sk-a3f9d8e2f14b...")).toBeVisible();
  await expect(pane.getByText("hunter2!@#")).toBeVisible();
  await expect(pane.getByText("전송됨 · 첨부: .env 내용")).toBeVisible();
  await expect(pane.getByText("샌드박스")).toBeVisible();
});

test("SCR-201 the summary and the stream report the run", async ({ page }) => {
  await page.goto("/demo");
  await pick(page, "T-01");
  await page.getByRole("button", { name: "적용 실행", exact: true }).click();

  // One block, nothing else — and the Replay deep link resolves once a run has been recorded.
  const summary = page.getByText("결과 요약").locator("..");
  await expect(summary.getByText("1")).toBeVisible();
  await expect(page.getByRole("link", { name: /Replay에서 보기/ })).toHaveAttribute("href", "/replay/s-0712");

  // The feed is wider than the cards: it also reports the calls that simply passed.
  const stream = page.getByRole("region", { name: "실시간 스트림" });
  await expect(stream.getByRole("row")).toHaveCount(4); // header + 3 events
  await expect(stream.getByText("list_directory")).toBeVisible();
  await expect(stream.getByText("readme.md")).toBeVisible();
});

test("SCR-201 only one run is in flight at a time", async ({ page }) => {
  await page.goto("/demo");
  await pick(page, "T-01");
  const other = page.getByRole("button", { name: "미적용 실행" });

  await page.getByRole("button", { name: "적용 실행", exact: true }).click();
  // The other mode locks while the run plays out, so the panes cannot disagree (no.2).
  await expect(other).toBeDisabled();
  await expect(page.getByRole("region", { name: GUARDED }).getByText("block_env_file_read")).toBeVisible();
  await expect(other).toBeEnabled();
});

test("SCR-201 a failed run offers a retry in the pane", async ({ page }) => {
  await page.goto("/demo");
  // Choose the scenario while the mock is healthy, then take the gateway down. The catalogue
  // keeps its last good payload, so the scenario stays selected and only the run request fails.
  await pick(page, "T-01");
  await page.getByRole("button", { name: "Mock API 상태 전환" }).click();
  await page.getByRole("button", { name: /미연결/ }).click();

  await page.getByRole("button", { name: "적용 실행", exact: true }).click();

  const pane = page.getByRole("region", { name: GUARDED });
  await expect(pane.getByText("Run 요청 실패")).toBeVisible({ timeout: 10_000 });
  await expect(pane.getByText(/attack-lab 컨테이너 상태를 확인하세요/)).toBeVisible();

  // Retrying once the gateway is back recovers in place.
  await page.getByRole("button", { name: /정상/ }).click();
  await pane.getByRole("button", { name: "재시도" }).click();
  await expect(pane.getByText("block_env_file_read")).toBeVisible({ timeout: 10_000 });
});
