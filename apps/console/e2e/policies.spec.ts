import { expect, test } from "@playwright/test";

// SCR-302 Policy Builder. `GET /policy-packs`, `GET /policies` and the two PUTs are served by the
// control plane, so the mock answers in its shapes — bare arrays, `packId`, an integer version.
//
// The per-row toggle is the exception worth knowing about while reading these: `PolicyUpdateRequest`
// has no `enabled` field, so what is exercised below is the console's behaviour against a backend
// that grows one. A real gateway accepts the call today and changes nothing.

test("GMCP-59 SCR-302 shows the packs, their policies and the YAML behind one", async ({ page }) => {
  await page.goto("/policies");

  // The tree counts what each pack contributes; the control plane reports no count, so this is
  // the join the screen does itself.
  const tree = page.getByRole("region", { name: "정책팩" });
  await expect(tree.getByRole("button", { name: "default", exact: true })).toBeVisible();
  await expect(tree.getByRole("button", { name: "korean-pii", exact: true })).toBeVisible();

  // The first pack is selected on arrival, so its policies are the ones in the table.
  const row = page.getByRole("row").filter({ hasText: "block_env_file_read" });
  await expect(row.getByText("100")).toBeVisible();
  await expect(row.getByText("차단")).toBeVisible();
  await expect(row.getByText("critical")).toBeVisible();
  await expect(row.getByText("14")).toBeVisible();

  // The YAML pane follows the selected row, captioned with the file the policy lives in.
  const yaml = page.getByRole("region", { name: "YAML" });
  await expect(yaml.getByText("policy-packs/default/policies/block-env-file-read.yaml")).toBeVisible();
  await expect(yaml.getByText("SECRET_FILE_ACCESS_BLOCKED")).toBeVisible();
});

test("SCR-302 selecting a pack swaps the table beneath it", async ({ page }) => {
  await page.goto("/policies");
  await expect(page.getByRole("row").filter({ hasText: "block_env_file_read" })).toBeVisible();

  await page.getByRole("button", { name: "korean-pii", exact: true }).click();

  // default's policies are gone and korean-pii's are in their place.
  await expect(page.getByRole("row").filter({ hasText: "block_env_file_read" })).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: "mask_korean_phone" })).toBeVisible();

  // A dry-run policy evaluates without acting: it is chipped as such instead of by verdict, and
  // it has no fired count to show.
  const dryRun = page.getByRole("row").filter({ hasText: "warn_external_url_fetch" });
  await expect(dryRun.getByText("dry-run")).toBeVisible();
  await expect(dryRun.getByText("–")).toBeVisible();
});

test("SCR-302 selecting a policy swaps the YAML pane", async ({ page }) => {
  await page.goto("/policies");
  const yaml = page.getByRole("region", { name: "YAML" });
  await expect(yaml.getByText("block-env-file-read.yaml")).toBeVisible();

  await page.getByRole("row").filter({ hasText: "approve_external_email" }).click();

  await expect(yaml.getByText("require-approval-external-secret-email.yaml")).toBeVisible();
  await expect(yaml.getByText("timeout_seconds: 120")).toBeVisible();
});

test("SCR-302 disabling a blocking policy asks first, and cancelling leaves it on", async ({ page }) => {
  await page.goto("/policies");
  const toggle = page.getByRole("switch", { name: "block_env_file_read 정책 사용" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await toggle.click();

  // FR-POL-04: dropping a block or a critical policy is questioned, because the console offers
  // no undo once it is gone.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/block_env_file_read는 차단 또는 critical/)).toBeVisible();

  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("SCR-302 confirming the prompt disables the policy", async ({ page }) => {
  await page.goto("/policies");
  const toggle = page.getByRole("switch", { name: "block_env_file_read 정책 사용" });

  await toggle.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "비활성화" }).click();

  await expect(toggle).toHaveAttribute("aria-checked", "false");

  // The screen refetches after the PUT rather than trusting the click, so the row going muted is
  // the reloaded payload rendering — not optimistic state. (A `page.reload()` would prove nothing
  // here: MSW lives in the page, so reloading reseeds the mock's store along with everything else.)
  const row = page.getByRole("row").filter({ hasText: "block_env_file_read" });
  await expect(row.getByText("critical")).toHaveClass(/text-grayscale-500/);
});

test("SCR-302 a policy that neither blocks nor is critical toggles without a prompt", async ({ page }) => {
  await page.goto("/policies");
  const toggle = page.getByRole("switch", { name: "approve_external_email 정책 사용" });

  await toggle.click();

  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("SCR-302 a pack switches off without a prompt", async ({ page }) => {
  await page.goto("/policies");
  const toggle = page.getByRole("switch", { name: "korean-pii 정책팩 사용" });

  await toggle.click();

  // Only policies are questioned; a pack is one deliberate act the operator already understands.
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("SCR-302 the fired count leads to the sessions that policy decided", async ({ page }) => {
  await page.goto("/policies");

  await page.getByRole("row").filter({ hasText: "block_env_file_read" }).getByRole("link", { name: "14" }).click();

  await expect(page).toHaveURL(/\/replay\?policy=block_env_file_read/);
});

test("SCR-302 counts what a dry-run policy would have decided", async ({ page }) => {
  await page.goto("/policies");

  // The panel is not scoped to the selected pack: a dry-run is a measurement in progress, and it
  // stays on screen while the operator reads the policy it is measuring against.
  const panel = page.getByRole("region", { name: "Dry-Run 통계" });
  await expect(panel.getByText("warn_external_url_fetch")).toBeVisible();
  await expect(panel.getByText("62")).toBeVisible();
});

test("SCR-302 points at the authoring guide when no packs are loaded", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("guardmcp.mock-scenario", "empty"));
  await page.goto("/policies");

  await expect(page.getByText("아직 정책이 없습니다")).toBeVisible();
  // Both links open in a new tab, so their accessible names say so (docs/ux/scr-302-empty-state.md).
  await expect(page.getByRole("link", { name: "정책 작성 가이드 새 창에서 열기" })).toBeVisible();
  await expect(page.getByRole("link", { name: "기본 정책팩 예제 새 창에서 열기" })).toBeVisible();
});

test("SCR-302 says what to do when the gateway is unreachable", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("guardmcp.mock-scenario", "offline"));
  await page.goto("/policies");

  await expect(page.getByText(/게이트웨이 연결을 확인한 뒤/)).toBeVisible();
});

test("SCR-302 says so when a toggle does not reach the gateway", async ({ page }) => {
  await page.goto("/policies");
  const toggle = page.getByRole("switch", { name: "approve_external_email 정책 사용" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // Drop the gateway *after* the screen has loaded, by writing the scenario straight to storage
  // rather than through the switcher — the switcher would announce it and refetch everything,
  // and what is under test is a write failing against a screen that already has its data.
  await page.evaluate(() => window.localStorage.setItem("guardmcp.mock-scenario", "offline"));
  await toggle.click();

  await expect(page.getByRole("status").filter({ hasText: /정책을 변경하지 못했습니다/ })).toBeVisible();
  // The switch reports what the gateway holds, not what was clicked.
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("SCR-302 floats the YAML pane over the table at 1024", async ({ page }) => {
  // The 1024 frame gives the pane no column of its own — it overlays the table's right edge,
  // because a third column there would leave the table too narrow to read.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/policies");

  const table = await page.getByRole("table").boundingBox();
  const pane = await page.getByRole("region", { name: "YAML" }).boundingBox();
  expect(table).not.toBeNull();
  expect(pane).not.toBeNull();
  expect(pane!.x).toBeLessThan(table!.x + table!.width);

  // At 1280 it takes a column instead, and stops overlapping.
  await page.setViewportSize({ width: 1280, height: 900 });
  const wide = await page.getByRole("table").boundingBox();
  const paneWide = await page.getByRole("region", { name: "YAML" }).boundingBox();
  expect(paneWide!.x).toBeGreaterThanOrEqual(wide!.x + wide!.width - 1);
});
