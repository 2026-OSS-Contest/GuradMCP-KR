import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// A build that inlines the mock flag serves fabricated data everywhere. It is opt-in and the
// status bar marks it at runtime, but the build log is where a release pipeline gets audited, so
// it says so there too — loudly enough to notice in a CI transcript nobody reads closely.
if (process.env.NEXT_PUBLIC_ENABLE_MOCK_API === "1") {
  console.warn(
    "\n\u001b[43m\u001b[30m MOCK API ENABLED \u001b[0m This build serves fabricated data from mocks/, " +
      "not a gateway.\n  Never ship it to a real deployment — unset NEXT_PUBLIC_ENABLE_MOCK_API.\n"
  );
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // `standalone` is for the Docker image (`containers.yml`). Vercel's builder cannot find
  // `.next/next-server.js.nft.json` under it and dies with `ENOENT` *after* reporting a
  // successful compile, so the log reads fine until its last line. Verified by deploying with
  // it on: the build fails at exactly that path.
  output: process.env.VERCEL ? undefined : "standalone",
  turbopack: { root: resolve(import.meta.dirname, "../..") },
  // The `/api/v1/*` proxy to the control plane (fix-api.md §2 — it serves no CORS headers, so the
  // browser must only ever talk to this origin) lives in `app/api/v1/[...path]/route.ts`, not in
  // a `rewrites()` entry here.
  //
  // It was a rewrite, and a rewrite cannot work in the deployment it was written for: `rewrites()`
  // runs at **build** time and its result is baked into `.next/routes-manifest.json`. The
  // Dockerfile passes no `CONTROL_PLANE_URL` build arg, so the function saw `undefined` and the
  // image shipped with `{"beforeFiles":[],"afterFiles":[],"fallback":[]}` — while
  // `docker-compose.yml` sets that variable at **run** time, where nothing reads it again. Every
  // `/api/v1/*` call to the console container answered 404.
  //
  // A route handler resolves the destination per request, so one image works in every
  // environment. See that file for why not to fix it with a build arg instead.
};

export default withNextIntl(nextConfig);
