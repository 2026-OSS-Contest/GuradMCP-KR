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
