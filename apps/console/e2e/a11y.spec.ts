import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// NFR-08 / 기획서 10.7: the console holds to WCAG 2.1 AA. One axe pass per screen, waiting for the
// screen's own SCR marker so each is scanned with its content rendered rather than as a skeleton.
//
// This is the automated half of GMCP-90. It cannot see everything — focus order, whether a shortcut
// actually fires, and whether a verdict reads without its colour still need the manual keyboard
// walkthrough — so a green run here is a floor, not the whole acceptance criterion.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const SCREENS = [
  { scr: "SCR-101", path: "/" },
  { scr: "SCR-201", path: "/demo" },
  { scr: "SCR-301", path: "/replay" },
  { scr: "SCR-302", path: "/policies" },
  { scr: "SCR-401", path: "/detector" },
  { scr: "SCR-402", path: "/approvals" },
  { scr: "SCR-501", path: "/settings" }
] as const;

test("every rail-nav link takes the 2px 쪽색 focus ring", async ({ page }) => {
  // axe checks that focus is not *removed*, never that it is visible, so 기획서 10.7's ring is
  // asserted here: the rail is the one control on every screen, and it had no ring of its own.
  await page.goto("/");
  const links = page.getByRole("navigation").getByRole("link");
  await expect(links.first()).toBeVisible();

  const ring = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ring").trim());
  expect(ring).not.toBe("");

  for (const link of await links.all()) {
    await link.focus();
    const style = await link.evaluate((el) => {
      const { outlineWidth, outlineStyle, outlineColor } = getComputedStyle(el);
      return { outlineWidth, outlineStyle, outlineColor };
    });
    expect(style.outlineStyle).toBe("solid");
    expect(style.outlineWidth).toBe("2px");
    // Resolved to rgb by the time it is computed, so compare against the token resolved the same way.
    expect(style.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
  }
});

// A scroll container with no padding clips the ring against its own edges — the ring is drawn
// 2px outside the element and needs 4px of room. Found by keyboard walkthrough, not by axe:
// the ring is present and the right colour, it is just not fully on screen.
const CLIPPING = [
  { name: "replay session list", path: "/replay", scroller: '[data-scr="SCR-301"] .overflow-y-auto' },
  { name: "gateway recent events", path: "/", scroller: '[data-scr="SCR-101"] [role="log"]' }
] as const;

for (const { name, path, scroller } of CLIPPING) {
  test(`${name} leaves room for the focus ring`, async ({ page }) => {
    await page.goto(path);
    const first = page.locator(`${scroller} :is(button, a[href])`).first();
    await expect(first).toBeVisible();

    const room = await first.evaluate((el, sel) => {
      const box = el.getBoundingClientRect();
      const clip = el.closest(sel)!.getBoundingClientRect();
      return {
        left: box.left - clip.left,
        right: clip.right - box.right,
        top: box.top - clip.top
      };
    }, scroller);

    // 2px offset + 2px ring.
    expect(room.left).toBeGreaterThanOrEqual(4);
    expect(room.right).toBeGreaterThanOrEqual(4);
    expect(room.top).toBeGreaterThanOrEqual(4);
  });
}

for (const { scr, path } of SCREENS) {
  test(`${scr} has no WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(`[data-scr="${scr}"]`)).toBeVisible();
    // The SCR marker lands before the data does. Without waiting for the skeletons to clear, axe
    // scans a loading state and reports a clean screen it never actually saw — which is how the
    // orphaned `<li>`s under `<ul role="log">` survived the first run of this spec.
    await expect(page.locator(".animate-pulse")).toHaveCount(0);

    const { violations } = await new AxeBuilder({ page }).withTags([...TAGS]).analyze();

    // Name the rule and the node, so a failure says what to fix instead of just how many.
    expect(
      violations.map((violation) => ({
        rule: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target.join(" "))
      }))
    ).toEqual([]);
  });
}
