import { expect, test } from "@playwright/test";

// SCR-000 common shell (spec §4.1). The dev server mocks `/overview` and pushes
// approval.created / approval.resolved over SSE (see mocks/), so this runs against the same
// contracts the control plane will serve.

// The mock raises an approval and resolves it again a tick later, so the true pending count only
// ever reads 2 or 3. Two stream ticks are enough to see it move and come back.
const STREAM_TICK_MS = 4_000;

test("SCR-000 pending-approval badge is seeded by the poll then moved by SSE", async ({ page }) => {
  await page.goto("/");
  const bar = page.getByRole("banner");

  // Seeded from the /overview poll.
  await expect(bar.getByRole("link", { name: /승인 대기 2/ })).toBeVisible();

  // An approval.created event bumps the badge live, without waiting for the next 10s poll.
  await expect(bar.getByRole("link", { name: /승인 대기 3/ })).toBeVisible({ timeout: STREAM_TICK_MS * 2 });
});

test("SCR-000 pending-approval badge never contradicts the ledger it is fed", async ({ page }) => {
  await page.goto("/");
  const badge = page.getByRole("banner").getByRole("link", { name: /승인 대기/ });
  await expect(badge).toBeVisible();

  // Sample across several stream ticks and a full /overview poll. Reconciling a poll used to
  // discard events that arrived while it was in flight, so their paired resolve subtracted from
  // a count that never included them and the badge sat on a value the mock never held.
  const seen = new Set<string>();
  const until = Date.now() + STREAM_TICK_MS * 4;
  while (Date.now() < until) {
    const label = (await badge.getAttribute("aria-label")) ?? "";
    seen.add(label.replace(/\D+/g, ""));
    await page.waitForTimeout(150);
  }

  expect([...seen].sort()).toEqual(["2", "3"]);
});

test("SCR-000 pending-approval badge deep-links to the approval screen (SCR-402)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: /승인 대기/ })).toHaveAttribute(
    "href",
    "/approvals"
  );
});

test("SCR-000 session picker lists the sessions and opens the chosen one on Replay", async ({ page }) => {
  await page.goto("/");
  // The label settles on the live session once `GET /sessions` resolves.
  const picker = page.getByRole("button", { name: /세션 #s-0712/ });
  await expect(picker).toHaveAttribute("aria-expanded", "false");

  await picker.click();
  const list = page.getByRole("listbox", { name: "세션" });
  await expect(list.getByRole("option", { name: /#s-0712.*LIVE/ })).toHaveAttribute("aria-selected", "true");

  // Choosing another session opens it on SCR-301, and the label follows the route.
  await list.getByRole("option", { name: /#s-0711/ }).click();
  await expect(page).toHaveURL(/\/replay\/s-0711$/);
  await expect(list).toBeHidden();
  await expect(page.getByRole("button", { name: /세션 #s-0711/ })).toBeVisible();
});

test("SCR-000 session picker closes when focus leaves it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /세션 #s-/ }).click();
  const list = page.getByRole("listbox", { name: "세션" });
  await expect(list).toBeVisible();

  // Outside click and Escape are covered elsewhere; tabbing out is the third way a popover is
  // expected to dismiss, and leaving it open strands the list behind the page content.
  await page.keyboard.press("Tab");
  await expect(list).toBeHidden();
});

test("SCR-000 session picker asks the gateway again each time it opens", async ({ page }) => {
  let calls = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/v1/sessions") && !url.includes("/timeline")) calls += 1;
  });

  await page.goto("/");
  const picker = page.getByRole("banner").getByRole("button", { name: /세션/ });
  await expect(picker).toBeVisible();
  await expect(page.getByRole("banner").getByText(/#s-0712/)).toBeVisible();
  const afterLoad = calls;

  // The empty and unreachable copy tells the operator to reopen the menu, so opening has to
  // actually re-request — otherwise only a page reload would ever recover.
  await picker.click();
  await expect(page.getByRole("listbox", { name: "세션" })).toBeVisible();
  expect(calls).toBeGreaterThan(afterLoad);
});

test("SCR-000 session picker closes on Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /세션 #s-/ }).click();
  await expect(page.getByRole("listbox", { name: "세션" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "세션" })).toBeHidden();
  // Focus returns to the trigger rather than being dropped at the top of the document.
  await expect(page.getByRole("button", { name: /세션 #s-/ })).toBeFocused();
});

test("SCR-000 session picker is operable from the keyboard alone", async ({ page }) => {
  await page.goto("/");
  const picker = page.getByRole("button", { name: /세션 #s-0712/ });
  await picker.focus();
  // ArrowDown opens the list and lands on the current session.
  await page.keyboard.press("ArrowDown");
  const list = page.getByRole("listbox", { name: "세션" });
  await expect(list.getByRole("option", { name: /#s-0712/ })).toBeFocused();
  // Arrows rove between options; Enter activates the focused one.
  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("option", { name: /#s-0713/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/replay\/s-0713$/);
});

// Both states need the very first load to be empty/failing, so the scenario is seeded before
// the app boots — a later switch would leave the last good session list on screen.

test("SCR-000 session picker explains an empty session list", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("guardmcp.mock-scenario", "empty"));
  // Not the gateway: with nothing registered its own empty frame draws a bare status bar, so the
  // picker is not on screen there to be asked.
  await page.goto("/replay");
  await page.getByRole("banner").getByRole("button", { name: /세션/ }).click();
  // Spec §4.2: the copy gives the cause and the next action.
  await expect(page.getByText(/데모를 실행하면 세션이 만들어집니다/)).toBeVisible();
});

test("SCR-000 session picker explains an unreachable gateway", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("guardmcp.mock-scenario", "offline"));
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: /세션/ }).click();
  await expect(page.getByText(/게이트웨이 연결을 확인한 뒤/)).toBeVisible();
});
