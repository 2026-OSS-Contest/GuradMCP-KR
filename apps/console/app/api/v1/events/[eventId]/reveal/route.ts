// fix-api.md §6, option 2: the console has no login, so there is no real per-request operator
// to attribute a reveal to — but `POST /events/{id}/reveal` still needs both of the control
// plane's independent gates (`AuditEventController.reveal`): a bearer-style shared secret
// (`X-Operator-Token`) and an attributed role (`X-Actor-Role: operator`). Injecting the secret
// here, in a Route Handler that only ever runs on the Next.js server, is what makes that safe —
// this file is never sent to the browser, unlike anything under `NEXT_PUBLIC_*`. It intercepts
// this one path ahead of `next.config.ts`'s blanket `/api/v1/*` rewrite (a filesystem route
// always wins over a rewrite for the same path), so every other endpoint keeps going through the
// plain proxy with no header injected, and this is the only one that needs one.
//
// `OPERATOR_TOKEN` is the same secret the control plane checks against its own
// `REVEAL_OPERATOR_TOKEN`/`security.reveal-token` (see docker-compose.yml, where both services
// read the one root `REVEAL_OPERATOR_TOKEN` env var) — unset on either side, reveal stays
// disabled exactly as it was, fail-closed (NFR-04).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
): Promise<Response> {
  const controlPlaneUrl = process.env.CONTROL_PLANE_URL;
  if (!controlPlaneUrl) {
    return Response.json(
      { code: "control_plane_unreachable", message: "CONTROL_PLANE_URL is not configured" },
      { status: 503 }
    );
  }

  const { eventId } = await params;
  const body = await request.text();
  const operatorToken = process.env.OPERATOR_TOKEN;

  try {
    const upstream = await fetch(`${controlPlaneUrl}/api/v1/events/${encodeURIComponent(eventId)}/reveal`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Actor-Id": "console",
        "X-Actor-Role": "operator",
        // Omitted (not sent as an empty string) when unconfigured, so the control plane's own
        // blank-token check — "an unconfigured token always denies" — is the one that answers.
        ...(operatorToken ? { "X-Operator-Token": operatorToken } : {})
      },
      body: body.length > 0 ? body : undefined,
      cache: "no-store"
    });

    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" }
    });
  } catch {
    // Same failure mode as every other `/api/v1/*` call when the control plane is down — the
    // blanket rewrite this route bypasses would have surfaced it identically as a fetch failure.
    return Response.json(
      { code: "control_plane_unreachable", message: "could not reach the control plane" },
      { status: 503 }
    );
  }
}
