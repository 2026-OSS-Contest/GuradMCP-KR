import { expect, test } from "@playwright/test";

// GMCP-21 flow 3: SSE 수신 확인.
//
// `useEventStream` (GMCP-86, lib/use-event-stream.ts) is the reconnecting SSE client behind
// SCR-101's recent-events feed; home.spec.ts already covers list growth and the
// reconnect/recover banner. This spec adds what those tests don't: that a streamed payload's
// own content (not a stale seed row) is what lands on screen, and that the insert-tint the spec
// promises for a fresh arrival (§6.3) both appears and clears on its own within its window —
// with no arbitrary waits, only assertions that retry until the mocked stream (`mocks/handlers.ts`,
// a `guard.event` push every 4s) delivers.

test("GMCP-21 a streamed guard.event's own payload renders, not a stale placeholder", async ({ page }) => {
  await page.goto("/");
  const events = page.locator('[data-scr] section', { hasText: "최근 보안 이벤트" });
  const rows = events.locator('[role="log"] ul > li');
  const seeded = await rows.count();

  await expect(async () => expect(await rows.count()).toBeGreaterThan(seeded)).toPass({ timeout: 12_000 });

  // The stream replays the live session's own verdicts rather than inventing events no other
  // screen has (mocks/data.ts), so the first push is that session's newest one: the mail held
  // for approval (GMCP-117).
  const streamed = rows.first();
  await expect(streamed).toContainText("send_email");
  await expect(streamed).toContainText("dae-eun.jung@example.co.kr");
  await expect(streamed.getByRole("link")).toHaveAttribute("href", /\/replay\/s-0712\?event=evt-live-0$/);
});

test("GMCP-21 a freshly streamed event gets the insert-tint, which clears within its own window", async ({ page }) => {
  await page.goto("/");
  // The tint class lands on the row's own link, not the `<li>` wrapper (components/gateway/recent-events.tsx).
  const rows = page.locator('[data-scr] [role="log"] ul > li > a');
  const seeded = await rows.count();

  await expect(async () => expect(await rows.count()).toBeGreaterThan(seeded)).toPass({ timeout: 12_000 });
  const fresh = rows.first();

  // Tint on arrival …
  await expect(fresh).toHaveClass(/event-tint/);
  // … and gone well before the next 4s push, per the hook's 1.5s freshMs default.
  await expect(fresh).not.toHaveClass(/event-tint/, { timeout: 3_000 });
});
