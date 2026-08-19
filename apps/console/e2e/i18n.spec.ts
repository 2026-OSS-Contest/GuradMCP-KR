import { expect, test, type Locator, type Page } from "@playwright/test";
import ko from "../messages/ko.json";

/**
 * NFR-07: the console runs in Korean by default and in English, and GMCP-89 asks for no missing
 * string on either. `messages/ko.json` and `messages/en.json` are two files nobody edits together
 * by accident — a screen added with only the Korean half looks finished until someone switches
 * the language, so the check belongs in CI rather than in a reviewer's head.
 *
 * The locale is a cookie (`i18n/config.ts`), not a URL segment, so each case sets it before the
 * first navigation and next-intl picks it up server-side.
 */

/** Anchors have to survive the switch, so each is a role or a marker rather than a translated string. */
const SCREENS = [
  // The recent-event feed prints tool arguments — a search query, a path, a recipient — which
  // are data in whatever language the operator's own systems speak, not copy to translate.
  {
    scr: "SCR-101",
    path: "/",
    anchor: (page: Page) => page.locator('[data-scr="SCR-101"]'),
    except: '[data-scr="SCR-101"] [role="log"]'
  },
  { scr: "SCR-201", path: "/demo", anchor: (page: Page) => page.locator('[data-scr="SCR-201"]') },
  { scr: "SCR-301", path: "/replay", anchor: (page: Page) => page.locator('[data-scr="SCR-301"]') },
  // SCR-302 carries no marker; "YAML" is the one heading the two bundles spell the same way.
  { scr: "SCR-302", path: "/policies", anchor: (page: Page) => page.getByRole("region", { name: "YAML" }) },
  { scr: "SCR-401", path: "/detector", anchor: (page: Page) => page.locator('[data-scr="SCR-401"]') },
  { scr: "SCR-402", path: "/approvals", anchor: (page: Page) => page.locator('[data-scr="SCR-402"]') },
  // The benchmark list is the Korean PII dataset itself — measured data, not copy to translate.
  // Everything else on the screen is still scanned.
  {
    scr: "SCR-601",
    path: "/benchmark",
    anchor: (page: Page) => page.locator('[data-scr="SCR-601"]'),
    except: '[data-testid="run-list"]'
  },
  { scr: "SCR-501", path: "/settings", anchor: (page: Page) => page.locator('[data-scr="SCR-501"]') }
] as const;

const LOCALES = ["ko", "en"] as const;

/**
 * Every key path the bundle defines. next-intl renders the path itself when a key resolves to
 * nothing, so matching against the real set is exact — a heuristic for "looks dotted" flags
 * hostnames and tool names instead (`docs.example.com`, `attack_lab.run`).
 */
const KEY_PATHS = new Set<string>();
(function collect(node: unknown, prefix = "") {
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) collect(value, prefix ? `${prefix}.${key}` : key);
  } else if (prefix) {
    KEY_PATHS.add(prefix);
  }
})(ko);

/** Scanning before the data lands reports a clean screen that was never rendered. */
async function settle(page: Page, anchor: Locator) {
  await expect(anchor).toBeVisible();
  await expect(page.locator(".animate-pulse")).toHaveCount(0);
}

/**
 * Visible copy only — script and template text carry RSC payloads that mention every locale.
 * `except` drops one more subtree, for a screen that renders data rather than copy.
 */
function visibleText(page: Page, except?: string): Promise<string[]> {
  return page.evaluate((skip) => {
    const seen: string[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(skip ? `script, style, template, ${skip}` : "script, style, template")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
    });
    let node: Node | null;
    while ((node = walk.nextNode())) {
      const text = (node.textContent ?? "").trim();
      if (text) seen.push(text);
    }
    return seen;
  }, except);
}

for (const locale of LOCALES) {
  for (const { scr, path, anchor } of SCREENS) {
    test(`${scr} resolves every message in ${locale}`, async ({ page, context }) => {
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1:3000" }]);

      // next-intl reports a missing key on the console and renders the key path in its place.
      const reported: string[] = [];
      page.on("console", (message) => {
        if (/MISSING_MESSAGE|INSUFFICIENT_PATH|IntlError/i.test(message.text())) reported.push(message.text());
      });
      page.on("pageerror", (error) => {
        if (/MISSING_MESSAGE|IntlError/i.test(String(error))) reported.push(String(error));
      });

      await page.goto(path);
      await settle(page, anchor(page));

      const leaked = (await visibleText(page)).filter((text) => KEY_PATHS.has(text));

      expect({ reported, leaked }).toEqual({ reported: [], leaked: [] });
    });
  }
}

for (const screen of SCREENS) {
  const { scr, path, anchor } = screen;
  const except = "except" in screen ? screen.except : undefined;
  test(`${scr} shows no Korean in en`, async ({ page, context }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1:3000" }]);
    await page.goto(path);
    await settle(page, anchor(page));

    // A key present in both bundles but never translated reads as Korean on an English screen —
    // which no missing-key check can see, because nothing is missing.
    const korean = (await visibleText(page, except))
      // The language picker names each language in its own language, so 한국어 stays.
      .filter((text) => /[가-힣]/.test(text) && text !== "한국어")
      .map((text) => text.slice(0, 80));

    expect([...new Set(korean)]).toEqual([]);
  });
}
