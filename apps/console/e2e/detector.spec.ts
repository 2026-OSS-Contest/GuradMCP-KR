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

test("SCR-401 switching direction drops the stale result, then runs the text the other way", async ({ page }) => {
  await page.goto("/detector");
  await page.getByRole("button", { name: "한국형 PII 샘플" }).click();
  await page.getByRole("button", { name: "검사 실행" }).click();
  await expect(page.getByText("PHONE").first()).toBeVisible();

  // The verdicts differ by direction, so a result from the other one no longer applies.
  await page.getByRole("button", { name: "response" }).click();
  await expect(page.getByText("텍스트를 입력 후 검사 실행 버튼을 클릭하세요.")).toBeVisible();

  // …and the debounce then runs the same text the other way, without anyone pressing anything.
  // Asserting the empty state *leaves* again is what keeps this honest: without the second half
  // the first would pass simply by being quicker than the 500ms pause.
  await expect(page.getByText("텍스트를 입력 후 검사 실행 버튼을 클릭하세요.")).toBeHidden();
});

test("SCR-401 runs on its own once typing settles", async ({ page }) => {
  await page.goto("/detector");

  // No button pressed anywhere in this test — spec §5.4 asks for a 500ms debounce beside the
  // manual run, and this is the automatic half.
  await page
    .getByRole("textbox", { name: "검사할 텍스트" })
    .fill("고객 연락처는 010-1234-5678입니다.");

  await expect(page.getByRole("region", { name: "탐지 결과" }).getByText("PHONE")).toBeVisible();
});

test("SCR-401 each sample loads its own material", async ({ page }) => {
  await page.goto("/detector");

  await page.getByRole("button", { name: "SECRET 샘플" }).click();
  const findings = page.getByRole("region", { name: "탐지 결과" });
  await expect(findings.getByText("SECRET").first()).toBeVisible();

  await page.getByRole("button", { name: "인젝션 샘플" }).click();
  await expect(findings.getByText("PATH").first()).toBeVisible();
  await expect(findings.getByText("attacker@evil.example")).toBeVisible();
});

test("SCR-401 refuses to run a text past the 64KB cap", async ({ page }) => {
  await page.goto("/detector");

  // One byte per character, so this is 65KB of a 64KB allowance.
  await page.getByRole("textbox", { name: "검사할 텍스트" }).fill("a".repeat(65 * 1024));

  await expect(page.getByRole("button", { name: "검사 실행" })).toBeDisabled();
  // The debounce has to refuse it too, or typing past the cap posts what the button prevents.
  await expect(page.getByText("텍스트를 입력 후 검사 실행 버튼을 클릭하세요.")).toBeVisible();
});

test("SCR-401 copies the masked text", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/detector");
  await page.getByRole("button", { name: "한국형 PII 샘플" }).click();
  await expect(page.getByRole("region", { name: "마스킹 결과" }).getByText("SECRET_OPENAI")).toBeVisible();

  await page.getByRole("button", { name: "마스킹 결과 복사" }).click();

  await expect(page.getByText("복사했습니다.")).toBeVisible();
  // What lands on the clipboard is the masked form — never the text that was pasted in.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("[SECRET_OPENAI]");
  expect(clipboard).not.toContain("sk-af1k2j3h4h5g6");
});

test("SCR-401 floats the results over the input at 1024", async ({ page }) => {
  // The 1024 frame gives the results no column of its own — the input keeps the full width and
  // the panel sits on top of its right edge, the same rule SCR-302 follows at that width.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/detector");

  const input = await page.getByRole("textbox", { name: "검사할 텍스트" }).boundingBox();
  const panel = await page.getByRole("region", { name: "탐지 결과" }).boundingBox();
  expect(panel!.x).toBeLessThan(input!.x + input!.width);

  // At 1280 the two split the row evenly and stop overlapping.
  await page.setViewportSize({ width: 1280, height: 900 });
  const wide = await page.getByRole("textbox", { name: "검사할 텍스트" }).boundingBox();
  const panelWide = await page.getByRole("region", { name: "탐지 결과" }).boundingBox();
  expect(panelWide!.x).toBeGreaterThanOrEqual(wide!.x + wide!.width - 1);
});

test("SCR-401 explains the direction toggle on demand, and takes 확인 for an answer", async ({ page }) => {
  await page.goto("/detector");
  await page.getByRole("button", { name: "방향별 기본 정책 강도가 다릅니다." }).click();

  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("방향별 기본 정책 강도가 다릅니다.");

  // The design's coach-mark carries its own dismiss, so reading it does not depend on knowing
  // that clicking away or pressing Escape would also work.
  await tooltip.getByRole("button", { name: "확인" }).click();
  await expect(tooltip).toBeHidden();
});

test("SCR-401 says what to do when the gateway is unreachable", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("guardmcp.mock-scenario", "offline"));
  await page.goto("/detector");
  await page.getByRole("button", { name: "한국형 PII 샘플" }).click();
  await page.getByRole("button", { name: "검사 실행" }).click();

  // Spec §4.2: the copy gives the cause and the next action.
  await expect(page.getByText(/게이트웨이 연결을 확인한 뒤 다시 실행하세요/)).toBeVisible();
});
