import { expect, test } from "@playwright/test";

// SCR-000 common shell (spec §4.1). The dev server mocks `/overview` and pushes
// approval.created / approval.resolved over SSE (see mocks/), so this runs against the same
// contracts the control plane will serve.

test("SCR-000 pending-approval badge is seeded by the poll then moved by SSE", async ({ page }) => {
  await page.goto("/");
  const bar = page.getByRole("banner");

  // Seeded from the /overview poll (pendingApprovals: 2).
  await expect(bar.getByRole("link", { name: /승인 대기 2/ })).toBeVisible();

  // An approval.created event bumps the badge live, without waiting for the next 10s poll.
  await expect(bar.getByRole("link", { name: /승인 대기 3/ })).toBeVisible({ timeout: 9_000 });
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

test("SCR-000 session picker closes on Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /세션 #s-/ }).click();
  await expect(page.getByRole("listbox", { name: "세션" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "세션" })).toBeHidden();
});
