import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Two directory levels up from this file always lands on the app root, whether
 * running compiled (`dist/lib/fixtures-root.js` -> `dist` -> app root) or via
 * `tsx` from source (`src/lib/fixtures-root.ts` -> `src` -> app root) — so the
 * same fixture directories resolve in dev and in the Docker runtime image.
 */
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const sandboxRoot = path.join(appRoot, "sandbox");
export const seedRoot = path.join(appRoot, "seed");
export const pagesRoot = path.join(appRoot, "pages");

/**
 * Read on every call (not frozen at import time) so tests can point it at a
 * throwaway directory via `DEMO_OUTBOX_DIR` without needing to control module
 * load order. Defaults to `/tmp/outbox`, which stays writable even when the
 * container filesystem is otherwise mounted read-only (compose mounts `/tmp`
 * as tmpfs — see demo-mcp-servers docker-compose `x-service-defaults`).
 */
export function outboxRoot(): string {
  return process.env.DEMO_OUTBOX_DIR ?? "/tmp/outbox";
}
