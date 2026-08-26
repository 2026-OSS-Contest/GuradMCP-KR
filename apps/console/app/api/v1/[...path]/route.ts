// The console's server-side proxy to the control plane.
//
// It exists because the control plane serves no CORS headers at all — no `CorsConfiguration`, no
// `addCorsMappings`, no `@CrossOrigin` — so a browser calling it cross-origin has every request
// blocked. Routing `/api/v1/*` through this server means the browser only ever talks to the
// console's own origin, and `lib/api/client.ts`'s `BASE` stays `""` exactly as it is under MSW.
//
// It replaces the `rewrites()` in `next.config.ts` that fix-api.md §2 introduced for the same
// purpose, which could not work in the deployment it was written for. `rewrites()` is evaluated
// **at build time** and its result is baked into `.next/routes-manifest.json`; the Dockerfile
// passes no `CONTROL_PLANE_URL` build arg, so the function saw `undefined`, returned `[]`, and
// the manifest shipped with `{"beforeFiles":[],"afterFiles":[],"fallback":[]}`. `docker-compose
// .yml` then sets `CONTROL_PLANE_URL` at **run** time, where nothing reads it again. Confirmed by
// running the stack: every `/api/v1/*` request to the console container answered 404 while the
// same request straight to `control-plane:8080` answered 200.
//
// Baking the URL in at build time via a build arg would have been the smaller change and the
// wrong one — it makes the image environment-specific, so the artefact that was tested is not the
// artefact that ships. Resolving it per request keeps one image good everywhere.

import type { NextRequest } from "next/server";

/** Never prerender or cache: this is a pass-through to a live service. */
export const dynamic = "force-dynamic";

/**
 * Connection-level headers that describe *this* hop and must not be forwarded to the next one
 * (RFC 9110 §7.6.1). `host` would name the console rather than the control plane, and
 * `content-length`/`transfer-encoding` are re-derived by `fetch` from the body it actually sends
 * — passing the originals through can leave the upstream waiting for bytes that never come.
 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
]);

function forwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
  }
  // Deliberately *not* injecting the server-side `OPERATOR_TOKEN` here. The operator headers are
  // the caller's to present (`lib/api/permissions.ts`), and a proxy that added them would make
  // every browser session an operator no matter what the control plane's `PermissionService`
  // was configured to allow — silently turning a fail-closed default into a fail-open one.
  return headers;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const base = process.env.CONTROL_PLANE_URL;
  if (!base) {
    // A deployment with no backend configured. Said plainly and once, rather than 404ing as if
    // the route did not exist — that is what sent the previous failure looking in the wrong place.
    return Response.json(
      {
        code: "control_plane_not_configured",
        message: "CONTROL_PLANE_URL is not set on the console server",
        details: {}
      },
      { status: 503 }
    );
  }

  const { path } = await context.params;
  const target = new URL(`/api/v1/${path.map(encodeURIComponent).join("/")}`, base);
  target.search = request.nextUrl.search;

  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: forwardedHeaders(request),
      body: hasBody ? request.body : undefined,
      // Required by the Fetch standard whenever `body` is a stream: it says the request body may
      // still be arriving while the response starts. Node's fetch rejects a stream body without it.
      ...(hasBody ? { duplex: "half" } : {}),
      // Follow the control plane's own semantics rather than resolving redirects here, so a 3xx
      // reaches the client as a 3xx.
      redirect: "manual",
      // The console's own request, not the browser's — this connection carries no cookies.
      cache: "no-store"
    } as RequestInit);
  } catch (error) {
    // The control plane is configured but unreachable: still starting, wrong host, network gone.
    // 502 says "the thing behind me failed", which is what the screens' offline states read.
    return Response.json(
      {
        code: "control_plane_unreachable",
        message: error instanceof Error ? error.message : "upstream request failed",
        details: {}
      },
      { status: 502 }
    );
  }

  const headers = new Headers();
  for (const [name, value] of upstream.headers) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
  }
  // `GET /events/stream` is an SSE connection that never ends, so the body is handed straight
  // through as a stream rather than awaited — buffering it would hang every screen that listens.
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
