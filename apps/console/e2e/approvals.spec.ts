import { expect, test } from "@playwright/test";

// GMCP-21 flow 2: 승인 3택 처리 흐름 (approve / deny / mask).
//
// SCR-402 (Approval Console) is still a `ScreenStub` on this branch — there are no approve /
// deny / mask controls in the DOM, so the 3-way decision flow cannot be driven from the UI yet
// (the control-plane approval workflow itself landed backend-only; see commit history on
// services/control-plane). This spec covers the closest existing behaviour instead: the two
// entry points an operator has today, and that the destination screen is reachable and reports
// itself as a scaffold rather than silently 404ing or rendering blank. The interactive 3-way
// flow is a documented gap — see the PR description — pending SCR-402 UI.

test("GMCP-21 the status bar surfaces pending approvals and links to the Approval Console", async ({ page }) => {
  await page.goto("/");
  const pending = page.getByRole("link", { name: /승인 대기 2/ });
  await expect(pending).toBeVisible();

  await pending.click();
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.getByText("SCR-402")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval Console" })).toBeVisible();
  await expect(page.getByText(/스캐폴드 단계/)).toBeVisible();
});

test("GMCP-21 rail nav also reaches the Approval Console stub directly", async ({ page }) => {
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "Approval Console" })).toBeVisible();
  await expect(page.getByText("승인 대기열과 처리 이력")).toBeVisible();

  // The rail nav's own link stays reachable and marks the route consistently with the others.
  await page.goto("/");
  await page.getByRole("link", { name: "Approval" }).click();
  await expect(page).toHaveURL(/\/approvals$/);
});
