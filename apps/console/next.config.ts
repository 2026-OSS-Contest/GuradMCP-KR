import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

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
