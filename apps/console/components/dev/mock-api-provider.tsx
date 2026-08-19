"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MOCK_API } from "@/mocks/scenario";

/**
 * One start per page load, however many times the effect runs. React's dev-mode double
 * invocation calls this twice, and the second `worker.start()` throws "cannot configure an
 * already enabled network" — which used to leave `ready` false forever and the app blank.
 */
let starting: Promise<unknown> | null = null;

function startWorker(): Promise<unknown> {
  starting ??= import("@/mocks/browser").then(({ worker }) =>
    // Anything the mocks do not define — fonts, Next's own routes — must still go out.
    worker.start({ onUnhandledRequest: "bypass", quiet: true })
  );
  return starting;
}

/**
 * Starts the MSW worker before anything fetches, so the console talks to the mock API over
 * real HTTP rather than reaching for fixtures directly.
 *
 * The `import()` still emits a lazy chunk in production builds — the bundler keeps it whether
 * or not the guard can ever pass — but nothing requests it, so it costs no user bytes.
 */
export function MockApiProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!MOCK_API);

  useEffect(() => {
    if (!MOCK_API) return;
    let cancelled = false;
    // A service worker only registers in a secure context, and of the addresses that reach a dev
    // server only `localhost`, `127.0.0.1` and `[::1]` count as one — `0.0.0.0` and a LAN IP do
    // not. Without the worker nothing is mocked, so every /api/v1 call 404s against a Next server
    // that serves no such route, and the console fills with offline states and a live stream that
    // retries for ever. That is a long way from the cause, so name it here.
    if (!window.isSecureContext) {
      console.error(
        `[mocks] ${window.location.origin} is not a secure context, so the service worker cannot ` +
          "register and nothing will be mocked — every /api/v1 request will 404. Open the console " +
          "on http://localhost:3000 instead, or serve this origin over HTTPS."
      );
    }
    void startWorker()
      .catch((error) => {
        // Render the app anyway: it will show its offline state, which is diagnosable.
        // A blank page is not.
        console.error("[mocks] worker failed to start; requests will not be mocked", error);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rendering children before the worker is listening would let the first fetch escape it.
  if (!ready) return null;
  return children;
}
