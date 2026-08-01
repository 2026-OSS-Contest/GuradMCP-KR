import { expect, test } from "@playwright/test";

// FR-GW-02 §6/§8.2 — the mocked control plane (`mocks/handlers.ts`) mirrors the real
// downgrade-immediate / upgrade-confirm PUT /servers/{id}/trust contract.

test("SCR-501 downgrading a server's trust applies immediately with a confirmation toast", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "서버 신뢰 등급" })).toBeVisible();

  const trustSelect = page.locator("#trust-mail-server");
  await expect(trustSelect).toHaveValue("trusted");

  await trustSelect.selectOption("limited");

  await expect(page.getByText("mail_server 서버의 신뢰 등급이 limited(으)로 변경되었습니다.")).toBeVisible();
  await expect(trustSelect).toHaveValue("limited");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("SCR-501 upgrading a server's trust requires confirmation", async ({ page }) => {
  await page.goto("/settings");

  const trustSelect = page.locator("#trust-db-server");
  await expect(trustSelect).toHaveValue("untrusted");

  await trustSelect.selectOption("trusted");

  const modal = page.getByRole("alertdialog", { name: "신뢰 등급 상향 확인" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText("db_server")).toBeVisible();
  await expect(modal.getByText(/상향 후 더 이상 적용되지 않을 수 있습니다/)).toBeVisible();
  await expect(modal.getByText("상향 시 이 서버에서 오는 Tool Call의 위험 점수 가중치가 낮아집니다.")).toBeVisible();

  // The select must not have jumped ahead while the confirmation is pending.
  await expect(trustSelect).toHaveValue("untrusted");

  await modal.getByRole("button", { name: "이해했으며 등급을 상향합니다" }).click();

  await expect(modal).toBeHidden();
  await expect(trustSelect).toHaveValue("trusted");
  await expect(page.getByText("db_server 서버의 신뢰 등급이 trusted(으)로 변경되었습니다.")).toBeVisible();
});

test("SCR-501 canceling an upgrade leaves the grade unchanged", async ({ page }) => {
  await page.goto("/settings");

  const trustSelect = page.locator("#trust-file-server");
  await expect(trustSelect).toHaveValue("limited");
  await trustSelect.selectOption("trusted");

  const modal = page.getByRole("alertdialog", { name: "신뢰 등급 상향 확인" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "취소" }).click();

  await expect(modal).toBeHidden();
  await expect(trustSelect).toHaveValue("limited");
});

test("SCR-501 a Settings trust change is reflected on the Home inventory chip", async ({ page }) => {
  await page.goto("/settings");
  await page.locator("#trust-mail-server").selectOption("limited");
  await expect(page.getByText("mail_server 서버의 신뢰 등급이 limited(으)로 변경되었습니다.")).toBeVisible();

  // Client-side nav (not page.goto, which would reload and reset the mock's in-memory state —
  // the real Control Plane persists server-side, so this only matters for the mocked dev harness).
  await page.getByRole("link", { name: "Gateway" }).click();
  await expect(page.getByRole("button", { name: /mail_server.*limited/ })).toBeVisible();
});
