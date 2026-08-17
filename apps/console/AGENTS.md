<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project

## Design tokens

- The primitives are **generated from Figma — never edit them by hand.** Regenerate with the
  Figma plugin plus `npm run figma:bridge` (see `tools/figma-tokens/`).
- `app/theme.css` maps those primitives onto Tailwind v4 `@theme` utilities and shadcn/ui
  semantic variables. Change the mapping there, not the generated primitives.
- Tokens live in the **`@guardmcp/design-tokens` workspace package**, not in the app
  (기획서 10.7 — docs, reports and the console share one palette). `app/globals.css` imports
  `@guardmcp/design-tokens/tokens.css` before `theme.css`.
  Two consequences worth knowing: Tailwind never resolves the primitives — `@theme` stores
  `var(--primitive-…)` as the value and the browser resolves the chain, which is why the package
  can live outside the app at all. And the Dockerfile has to copy the package's **source**, not
  just its `package.json`: `npm ci` succeeds either way and leaves a dangling symlink that only
  fails later, during the build.
- Style with token utilities (`bg-grayscale-900`, `text-verdict-block`) instead of hardcoded
  colors. To reference a raw primitive use the Tailwind v4 form: `bg-(--primitive-...)`.
- **The radius names do not line up.** `theme.css` derives Tailwind's radius scale from shadcn's
  `--radius`, so `rounded-sm` is 8px, `rounded-lg` 12px and `rounded-xl` 16px — while the design's
  own `rounded-sm`/`lg`/`xl` are 4px, 8px and 12px. Every Tailwind radius is therefore one step
  too large. The design uses exactly four values (4 · 8 · 12 · 1000), so reference the primitive —
  `rounded-(--primitive-radius-rounded-xl)` — until that mapping is aligned.

## Matching a screen to its Figma frames

Each frame in `tools/figma-export/out/<scr-id>/<frame>/` exports three files, and they answer
different questions. Use all three — checking one and inferring the rest is how details get lost.

- **`.png`** — composition only. A 2px underline or a 6%-alpha ground is invisible at this size,
  so never conclude "it matches" from the image.
- **`.json`** — geometry and tokens: `x`/`y`/`w`/`h`, `fills` with their `variable` names,
  `radius`/`radiusVar`, `layout.pad`/`gap`, `font`/`fontSize`. It answers only what you ask it,
  so a property you did not think to query stays invisible.
- **`.html`** — **the authority for styling.** It is the frame rendered with resolved CSS: the
  typography class on each element (`text-body-text-b3-md`), and every inline run as its own
  `<span style="color:…">`. If the design tints a word and nothing more, this is where you see
  that there is no ground and no underline. Read it before writing any text-run styling.

Two more rules that come from the same failure:

- **Revising an existing screen means auditing the whole screen**, not just the lines you touch.
  Code that predates you is not evidence of anything; the frames are.
- Compare *every* exported frame, including the state variants. Their filenames say what state
  they are (`-empty`, `-reload`, `-입력-전`), and a screen can be right in one state and wrong in
  another — the SCR-401 result panes split evenly until findings arrive, and only the completed
  frame shows it.

## Fonts

- SUIT (Korean) and JetBrains Mono are **self-hosted** — files in `app/fonts/`, `@font-face`
  in `app/fonts.css`. The family names must match the ones the generated `.text-*` classes use.

## Icons and brand

- Nav and UI icons are **extracted from the Figma design**, not hand-drawn and not replaced
  with a generic icon set — see `components/shell/nav-icons.tsx`. Their fill is `currentColor`
  so they follow the surrounding text color.
- Logo and favicon come from the official brand asset kit (`public/brand/`, `app/icon.svg`).

## API and mock data

- **Follow the real implementation or the written spec — never invent a contract.** Before
  adding a call, check `services/control-plane/src/main/kotlin/**/api/*Controller.kt` for the
  route, verb and DTOs, and the domain types beside it for the wire enums. Match the path, the
  HTTP method, the field names and the response shape exactly, including whether it answers a
  bare array or an envelope. If an endpoint genuinely does not exist, say so in the type or
  client comment and name the ticket that owns it — do not quietly design a nicer endpoint the
  backend will never serve. A screen that talks to a shape nobody implements looks finished and
  is not.
- Where the design needs a field the control plane does not report, keep it **optional** on the
  wire type, supply it from `mocks/`, and make the screen degrade when it is absent. That is why
  `PolicyRow.enabled` and `SecurityEvent`'s risk enrichment are optional.
- Screens fetch from `lib/api/client.ts` (`/api/v1/…`). The contracts in `lib/api/types.ts` are
  what the **UI specification** asks for, not what the control plane returns today — most of
  §6.2 is still unimplemented.
- In development, `mocks/` serves those endpoints through **MSW** over real HTTP, so components
  see genuine loading, error and offline paths. Set `NEXT_PUBLIC_API_BASE_URL` to talk to a real
  backend instead; the mocks then switch themselves off.
- The dev-only flask button (bottom right) switches between the `full` / `empty` / `offline`
  states. Add a state by extending `mocks/scenario.ts` and `mocks/data.ts`.
- The gateway event stream (`lib/sse.ts`, `EventSource`) is mocked too: MSW's `sse()` handler
  serves `/api/v1/events/stream` under the mock and pushes a `guard.event` every few seconds.
  It points at the real gateway when `NEXT_PUBLIC_API_BASE_URL` is set. `msw init` regenerates
  `public/mockServiceWorker.js`; keep it on a version that supports SSE (≥ 2.12).

## Routing (SCR scheme)

- Screens follow the UI specification's `SCR-{area}{number}` ids; the common shell is SCR-000.
- Every console screen lives under the `(console)` route group and inherits the
  `RailNav` + `StatusBar` shell.
- Keep the SCR id visible on the page (for example the `scr` prop of `ScreenStub`) so screens
  stay traceable back to the specification.

## i18n

- `next-intl`, **cookie-based** (`NEXT_LOCALE`) — the locale is not part of the URL.
- Every user-facing string belongs in `messages/ko.json` **and** `messages/en.json`.

## Dev, build and test

- The dev server runs Turbopack (`next dev --turbopack`).
- **Open it on `localhost`.** MSW mocks the API from a service worker, and a service worker only
  registers in a secure context — of the addresses that reach the dev server only `localhost`,
  `127.0.0.1` and `[::1]` qualify. On `0.0.0.0` or a LAN IP the worker never registers, so nothing
  is mocked: every `/api/v1` call 404s against a server that serves no such route, and the screens
  fill with offline states and a live stream that retries for ever. The provider logs the reason,
  but the symptom points nowhere near it. Reaching the console from another device needs HTTPS —
  `next dev --experimental-https` or a tunnel — and `allowedDevOrigins` in `next.config.ts`, since
  Next answers cross-origin dev requests with 403 otherwise.
- Do **not** run `next build` while `next dev` is running — it clobbers `.next` and the dev
  server then serves 500s. Stop the dev server first.
- Playwright specs live in `e2e/`, but `@playwright/test` is a **root** devDependency; run them
  from the repository root with `npm run test:e2e`.
- `npm run lint`, `npm run typecheck` and `npm run build` must pass before pushing.

## Deployment (Vercel)

- The Vercel project's **Root Directory is `apps/console`**, so Vercel installs the npm
  workspace from the repository root. The console therefore relies on root devDependencies
  such as `typescript` and `@playwright/test` — **do not duplicate build-only devDependencies
  into `apps/console/package.json`** just to make a standalone deploy succeed.
- Deploy **from the repository root** using environment variables, so no `.vercel/` directory
  and no git changes are produced:

  ```bash
  VERCEL_ORG_ID=<org> VERCEL_PROJECT_ID=<project> vercel deploy --prod --token <token> --yes
  ```

  Do **not** run `vercel link` to get those ids — it writes `.vercel/` and appends to the root
  `.gitignore`. Read them from an existing deployment instead: `vercel project ls` names the
  project (`guardmcp-kr-console`), and `vercel project inspect guardmcp-kr-console` prints its
  Root Directory and Node version without touching the tree.

### Three things break a Vercel build

All three are handled in the tree now; this section is why the code looks the way it does, and
what to check first when a deploy fails anyway. Each is dormant in normal development, and each
was confirmed by a deploy that failed on it.

1. **`output: "standalone"` fails the build.** `next.config.ts` sets it for the Docker image
   (`containers.yml`), but Vercel's builder then cannot find `.next/next-server.js.nft.json`
   and dies with `ENOENT` *after* reporting a successful compile — so the log looks fine until
   the last line. It is guarded on Vercel's own env var, which the platform always sets:

   ```ts
   output: process.env.VERCEL ? undefined : "standalone",
   ```

2. **MSW cannot start in a production build.** Vercel builds with `NODE_ENV=production`, so a
   `NODE_ENV === "development"` gate alone leaves the deployed console rendering its shell,
   fetching `/api/v1/…` against its own origin and 404ing everywhere. `mocks/scenario.ts` takes
   an opt-in flag as well, and it has to be passed at **build** time — `NEXT_PUBLIC_*` is
   inlined during the build, so `--build-env` is required and `--env` does nothing:

   ```bash
   vercel deploy --prod --yes --build-env NEXT_PUBLIC_ENABLE_MOCK_API=1
   ```

   Without that flag nothing changes, so the gate costs an ordinary build nothing. `msw` is a
   devDependency, which is fine — Vercel installs devDependencies — and
   `public/mockServiceWorker.js` is committed, so nothing else is needed. The scenario switcher
   is **not** carried in by this: the floating flask tests `NODE_ENV === "development"` on its
   own, so a mock-backed deploy serves the mocks and draws no dev control over them.

3. **A stray `pnpm-lock.yaml` under `apps/console` fails the install.** The Vercel project's
   Root Directory *is* `apps/console`, so a lockfile sitting there decides the package manager
   for the whole build: the builder switched to pnpm and `--frozen-lockfile` refused a lockfile
   that predated `@guardmcp/design-tokens`. This repository is npm workspaces (`packageManager:
   npm@10.9.4`, and CI runs `npm ci`), so nothing under `apps/console` should carry a lockfile
   of its own. Two were deleted in GMCP-117; if a deploy dies at `Installing dependencies...`,
   check that they have not come back — running `pnpm install` inside `apps/console` recreates
   them.

- Setting `NEXT_PUBLIC_API_BASE_URL` switches the mocks off no matter what else is set; leave it
  unset for a mock-backed deploy.
- Verify a deploy by loading it and checking that `/api/v1/overview` answers **200**. The app
  serves no such route itself, so a 200 there means the service worker is intercepting; a 404
  means the build shipped without mocks.
