# figma-tokens

Pull **Figma local Variables** into the console as CSS custom properties — works on
Figma's **free plan** (the Plugin API can read variables, unlike the Enterprise-only
Variables REST API).

Two pieces:

- `plugin/` — a local (unpublished) Figma plugin that reads `figma.variables.*` and
  POSTs them to the bridge. Plain JS, no build step.
- `bridge/server.mjs` — a dependency-free Node HTTP server that writes the tokens to
  `apps/console/app/tokens.css`.

## Usage

1. **Start the bridge** (repo root):

   ```bash
   npm run figma:bridge
   ```

   Listens on `http://localhost:3999` and writes `apps/console/app/tokens.css`.

2. **Load the plugin** in the Figma desktop app:

   - Menu → **Plugins → Development → Import plugin from manifest…**
   - Select `apps/console/tools/figma-tokens/plugin/manifest.json`.

3. **Run it** with your design file open: **Plugins → Development → GuardMCP Token Sync**,
   then click **Sync tokens → repo**.

`tokens.css` is regenerated on each run. `app/globals.css` imports `tokens.css` before
`theme.css`, so the primitives are defined by the time the `@theme` mapping references them.

## Exporting screens and components

The sibling plugin `../figma-export/plugin/` sends the exact structure of what you select to
the same bridge, which writes drafts under `../figma-export/out/` (gitignored). Import its
`manifest.json` the same way, then select something and click **선택 → repo 내보내기**.

**Sections are folders, and so is every item.** Selecting a section walks into it and gives
each frame, component and component set its own directory holding `name.json` +
`name.html` + `name.png`, mirroring nested sections as nested directories:

```
out/
  scr-000-shell/
    rail-nav/
      rail-nav.json  rail-nav.html  rail-nav.png
    status-bar/
      status-bar.json ...
  scr-100-gateway/
    kpi-cards/                # nested section
      kpi-card/
        kpi-card.json ...
```

Notes:

- A component set is **one** item — its variants sit side by side in a single file.
- Folder and file names **keep Hangul** (`scr-101-게이트웨이-홈/`). Only the CSS identifiers in
  `tokens.css` are ASCII-slugged. If two frames in one folder still share a name, the later
  ones get `-2`, `-3` and the bridge logs a warning — nothing is overwritten silently.
- Loose text/vector layers directly inside a section are skipped (they are usually
  annotations); selecting one directly still exports it.
- Each run **wipes the section folders it is about to write**, plus each item folder it
  touches, so frames renamed or deleted in Figma leave no stale files behind. Folders the run
  does not write are left alone.
- Items are streamed one request at a time, so a large section never builds one huge message.
- The `.html` drafts are **references, not shippable code** — they are absolutely positioned
  where Figma had no auto-layout. Read them (and the `.png` next to them) to get exact
  measurements, then write real components by hand.
- **Icons only survive in the `.html`.** They come across as inline SVG data URIs; the `.json`
  replaces every blob with a `<1234b>` placeholder so it stays readable. That means a draft
  cannot be regenerated from its own `.json` — re-run the plugin instead.
- A wrapper whose whole subtree is artwork is exported as **one** SVG, so Figma resolves its
  masks and boolean operations. Add text or a photo inside and it becomes a layout frame again,
  exported node by node.

The generator translates a few Figma concepts that do not map onto CSS one to one. If a draft
looks wrong, check these first:

| Figma | CSS it emits |
| --- | --- |
| `FILL` sizing | `flex:1 1 0` along the parent's direction, `align-self:stretch` across it |
| `INSIDE` / `OUTSIDE` stroke | inset / outset `box-shadow` ring, so the box does not grow |
| per-side stroke weights | one `box-shadow` per side — a bottom-only divider stays a rule |
| `lineHeight` `150%`, font style `SemiBold` | `line-height:150%`, `font-weight:600` |
| per-character text colours | one `<span>` per styled segment |

Widths from Figma already include padding and stroke, so the drafts set `box-sizing:border-box`.

## Mapping

- Variable `Colors / bg / base` → `--colors-bg-base`
- Default collection mode → `:root { … }`
- Additional modes (e.g. `Dark`) → `[data-theme="dark"] { … }`
- `COLOR` → hex (or `rgba()` when alpha < 1); `FLOAT` → `px`; alias → `var(--…)`

Adjust the `FLOAT`-to-`px` assumption or mode-selector strategy in `bridge/server.mjs`
if your token conventions differ.
