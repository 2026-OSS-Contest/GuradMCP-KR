# Architecture

`awesome-project` ships as a single ESM entry point with a CJS shim generated at
build time via `tsup`. There is no runtime dependency graph to speak of: date and
currency formatting are implemented directly on top of `Intl`, so the bundle
stays under 2KB minified.

## Modules

- `format/date.ts` — thin wrapper around `Intl.DateTimeFormat` with a small set
  of Korean-locale presets (`YYYY-MM-DD`, `YY.MM.DD`, relative "n일 전").
- `format/currency.ts` — wraps `Intl.NumberFormat` for KRW, adding the trailing
  `원` suffix that `Intl` alone does not produce.
- `index.ts` — re-exports the public API surface.

## Build

`npm run build` runs `tsup` twice (once per output format) and `npm run test`
runs the Vitest suite against both entry points to catch format drift.
