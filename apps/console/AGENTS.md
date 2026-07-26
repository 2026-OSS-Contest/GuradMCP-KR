<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project

## Design tokens

- `app/tokens.css` is **generated from Figma — never edit it by hand.** Regenerate with the
  Figma plugin plus `npm run figma:bridge` (see `tools/figma-tokens/`).
- `app/theme.css` maps those primitives onto Tailwind v4 `@theme` utilities and shadcn/ui
  semantic variables. Change the mapping there, not the generated primitives.
- Tokens live **inside the app** (`app/`), not in a separate workspace package.
- Style with token utilities (`bg-grayscale-900`, `text-verdict-block`) instead of hardcoded
  colors. To reference a raw primitive use the Tailwind v4 form: `bg-(--primitive-...)`.

## Fonts

- SUIT (Korean) and JetBrains Mono are **self-hosted** — files in `app/fonts/`, `@font-face`
  in `app/fonts.css`. The family names must match the ones the generated `.text-*` classes use.

## Icons and brand

- Nav and UI icons are **extracted from the Figma design**, not hand-drawn and not replaced
  with a generic icon set — see `components/shell/nav-icons.tsx`. Their fill is `currentColor`
  so they follow the surrounding text color.
- Logo and favicon come from the official brand asset kit (`public/brand/`, `app/icon.svg`).

## API and mock data

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
