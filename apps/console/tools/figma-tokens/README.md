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

`tokens.css` is regenerated on each run. Import order matters — `tokens.css` is imported
before `styles.css` in `apps/console/app/layout.tsx` so the variables resolve.

## Mapping

- Variable `Colors / bg / base` → `--colors-bg-base`
- Default collection mode → `:root { … }`
- Additional modes (e.g. `Dark`) → `[data-theme="dark"] { … }`
- `COLOR` → hex (or `rgba()` when alpha < 1); `FLOAT` → `px`; alias → `var(--…)`

Adjust the `FLOAT`-to-`px` assumption or mode-selector strategy in `bridge/server.mjs`
if your token conventions differ.
