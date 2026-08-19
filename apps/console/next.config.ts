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
};

export default withNextIntl(nextConfig);
