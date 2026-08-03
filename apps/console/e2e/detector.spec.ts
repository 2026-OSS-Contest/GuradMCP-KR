import { expect, test } from "@playwright/test";

// SCR-401 Detector. `POST /detect/preview` is one of the few endpoints the control plane already
// serves; in dev MSW answers it, covering the detectors the seeded pack does not reach yet.

test("GMCP-56 SCR-401 waits for a text before it reports anything", async ({ page }) => {
  await page.goto("/detector");

  await expect(page.getByRole("button", { name: "request" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByPlaceholder("검사하고 싶은 텍스트를 입력해주세요")).toBeVisible();
  await expect(page.getByText("텍스트를 입력 후 검사 실행 버튼을 클릭하세요.")).toBeVisible();
  // Nothing to inspect yet, and the input is explicit that it is not kept.
  await expect(page.getByRole("button", { name: "검사 실행" })).toBeDisabled();
  await expect(page.getByText("입력한 텍스트는 저장되지 않습니다.")).toBeVisible();
});

test("SCR-401 a sample runs and reports each finding with its masked form", async ({ page }) => {
  await page.goto("/detector");
  await page.getByRole("button", { name: "한국형 PII 샘플" }).click();
  await page.getByRole("button", { name: "검사 실행" }).click();

  // Every detector the design draws, tagged and scored.
  const findings = page.getByRole("region", { name: "탐지 결과" });
  await expect(findings.getByText("PHONE")).toBeVisible();
  await expect(findings.getByText("010-1234-5678")).toBeVisible();
  await expect(findings.getByText("98%").first()).toBeVisible();
  // The resident number is never echoed in full, even by the thing that flagged it.
  await expect(findings.getByText("900101-*******")).toBeVisible();
  await expect(findings.getByText("900101-1234567")).toBeHidden();

  // The masked pane substitutes a chip per finding.
  const masked = page.getByRole("region", { name: "마스킹 결과" });
  await expect(masked.getByText("SECRET_OPENAI")).toBeVisible();
  await expect(masked.getByText("sk-af1k2j3h4h5g6")).toBeHidden();
});

test("SCR-401 choosing a finding selects it in the input", async ({ page }) => {
  await page.goto("/detector");
  await page.getByRole("button", { name: "한국형 PII 샘플" }).click();
  await page.getByRole("button", { name: "검사 실행" }).click();

  await page.getByRole("region", { name: "탐지 결과" }).getByText("010-1234-5678").click();

  // Selecting the match is what scrolls the textarea to it and shows which run of text it was.
  const selected = await page.evaluate(() => {
    const input = document.querySelector("textarea");
    return input?.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  });
  expect(selected).toBe("010-1234-5678");
});

test("SCR-401 editing or switching direction drops the stale result", async ({ page }) => {
  await page.goto("/detector");
  await page.getByRole("button", { name: "한국형 PII 샘플" }).click();
  await page.getByRole("button", { name: "검사 실행" }).click();
  await expect(page.getByText("PHONE").first()).toBeVisible();

  // The verdicts differ by direction, so a result from the other one no longer applies.
  await page.getByRole("button", { name: "response" }).click();
  await expect(page.getByText("텍스트를 입력 후 검사 실행 버튼을 클릭하세요.")).toBeVisible();
});

test("SCR-401 explains the direction toggle on demand", async ({ page }) => {
  await page.goto("/detector");
  await page.getByRole("button", { name: "방향별 기본 정책 강도가 다릅니다." }).click();
  await expect(page.getByRole("tooltip")).toHaveText("방향별 기본 정책 강도가 다릅니다.");
});

test("SCR-401 says what to do when the gateway is unreachable", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("guardmcp.mock-scenario", "offline"));
  await page.goto("/detector");
  await page.getByRole("button", { name: "한국형 PII 샘플" }).click();
  await page.getByRole("button", { name: "검사 실행" }).click();

  // Spec §4.2: the copy gives the cause and the next action.
  await expect(page.getByText(/게이트웨이 연결을 확인한 뒤 다시 실행하세요/)).toBeVisible();
});
