import { expect, test } from "@playwright/test";

// SCR-501 Settings. Neither `GET /settings` nor `PUT /servers/{id}` exists on the control plane —
// both belong to GMCP-80 — so MSW is the whole server here, not just a stand-in for one.
//
// The rule these tests are mostly about: a change that makes the system *less* safe is confirmed
// before it is applied, and its opposite goes straight through.

test("GMCP-88 SCR-501 shows the upstreams, the failure policy and the preferences", async ({ page }) => {
  await page.goto("/settings");

  const row = page.getByRole("row").filter({ hasText: "file_server" });
  await expect(row.getByText("http://file-mcp:8801/sse")).toBeVisible();
  // One of file_server's three tools changed its description since it was first seen.
  await expect(row.getByText("변경 감지 1")).toBeVisible();

  await expect(page.getByRole("row").filter({ hasText: "mail_server" }).getByText("정상")).toBeVisible();
  // A disconnected server reports nothing, so its snapshot state is unknown rather than clean.
  await expect(page.getByRole("row").filter({ hasText: "db_server" }).getByText("연결 끊김")).toBeVisible();

  // The gateway ships fail-closed, raw storage off, and a 120s approval window.
  await expect(page.getByRole("radio", { name: /Fail-Closed/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: "원문 저장 opt-in" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("combobox", { name: "승인 타임아웃" })).toHaveValue("120");
});

test("SCR-501 fail-open needs an acknowledgement before it can be saved", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: /Fail-Open/ }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/게이트웨이 장애 발생 시에도 Tool Call이 계속 허용/)).toBeVisible();
  // Reading the notice is not the same as accepting it, so the confirm stays inert until ticked.
  await expect(dialog.getByRole("button", { name: "저장" })).toBeDisabled();

  await dialog.getByRole("checkbox", { name: "해당 내용을 인지했습니다." }).check();
  await expect(dialog.getByRole("button", { name: "저장" })).toBeEnabled();

  // Backing out leaves the gateway as it was.
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("radio", { name: /Fail-Closed/ })).toHaveAttribute("aria-checked", "true");
});

test("SCR-501 confirming fail-open applies it, and going back does not ask", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: /Fail-Open/ }).click();
  await page.getByRole("checkbox", { name: "해당 내용을 인지했습니다." }).check();
  await page.getByRole("alertdialog").getByRole("button", { name: "저장" }).click();

  await expect(page.getByRole("radio", { name: /Fail-Open/ })).toHaveAttribute("aria-checked", "true");

  // Returning to fail-closed reduces exposure, so it needs no second thought.
  await page.getByRole("radio", { name: /Fail-Closed/ }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(page.getByRole("radio", { name: /Fail-Closed/ })).toHaveAttribute("aria-checked", "true");
});

test("SCR-501 turning raw storage on explains itself first", async ({ page }) => {
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "원문 저장 opt-in" });

  await toggle.click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/원문이 저장되어 이후 기능에 활용됩니다/)).toBeVisible();
  // Unlike fail-open this one only explains — there is no acknowledgement to tick.
  await expect(dialog.getByRole("checkbox")).toBeHidden();

  await dialog.getByRole("button", { name: "적용" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // And turning it back off stops the collection, so it applies immediately.
  await toggle.click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("SCR-501 raising a server's trust is confirmed, lowering it is not", async ({ page }) => {
  await page.goto("/settings");
  const trust = page.getByRole("combobox", { name: "file_server 신뢰 등급" });

  // limited → trusted relaxes what that upstream may do.
  await trust.selectOption("trusted");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/제한이 완화됩니다/)).toBeVisible();
  await dialog.getByRole("button", { name: "적용" }).click();
  await expect(trust).toHaveValue("trusted");

  // trusted → untrusted tightens it, and goes straight through.
  await trust.selectOption("untrusted");
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(trust).toHaveValue("untrusted");
});

test("SCR-501 saves the preferences that carry no risk", async ({ page }) => {
  await page.goto("/settings");

  await page.getByRole("combobox", { name: "승인 타임아웃" }).selectOption("300");

  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(page.getByRole("combobox", { name: "승인 타임아웃" })).toHaveValue("300");
});

test("SCR-501 switches the console's language", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "Setting" })).toBeVisible();

  await page.getByRole("combobox", { name: "언어" }).selectOption("en");

  // next-intl resolves the locale from a cookie on the server, so this only works if the control
  // writes that cookie — storing the preference on the gateway alone leaves the page in Korean.
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Endpoint" })).toBeVisible();
  // And it survives a reload, which is the point of a cookie rather than component state.
  await page.reload();
  await expect(page.getByRole("columnheader", { name: "Endpoint" })).toBeVisible();
});

test("SCR-501 says what to do when the gateway is unreachable", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("guardmcp.mock-scenario", "offline"));
  await page.goto("/settings");

  await expect(page.getByText(/게이트웨이 연결을 확인한 뒤/)).toBeVisible();
});
