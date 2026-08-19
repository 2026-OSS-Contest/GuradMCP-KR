// GMCP-84 §7: this console has no login/session system, so — same as the control plane's own
// `PermissionService` MVP — a deployment's operator identity is a fixed, env-provided claim
// rather than a per-user one. Real per-user RBAC is out of scope (see PermissionService's doc
// comment); this is the client half of the same MVP shortcut.
//
// Its own module, not part of `client.ts`: `replay-adapter.ts` needs `hasOperatorPermissions` for
// `canReveal`, and `client.ts` imports `replay-adapter.ts` already — folding this into
// `client.ts` would make that a cycle.

import { MOCK_API } from "@/mocks/scenario";

const PERMISSIONS_STORAGE_KEY = "guardmcp.operator-permissions";

/** Explicit dev/e2e override, the same localStorage-driven pattern `mocks/scenario.ts` uses for
 *  the empty/offline states — see `writeScenario`'s doc comment. */
function readPermissionsOverride(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  const stored = window.localStorage.getItem(PERMISSIONS_STORAGE_KEY);
  if (stored === "granted") return true;
  if (stored === "denied") return false;
  return undefined;
}

/**
 * Whether this build/session carries an operator identity at all — used only to decide what the
 * UI *offers* (SCR-301 원문 열람 button, SCR-501 opt-in toggle). It is not the access control: the
 * control plane's `PermissionService` re-checks the actual headers on every request regardless
 * (§7's "프론트 숨김은 UX 편의일 뿐, 실제 통제는 항상 서버가 담당한다").
 *
 * Three sources, most specific first:
 * 1. The localStorage override (e2e's `events:reveal 권한 없는 계정` scenario, §10.4).
 * 2. Under MSW (`MOCK_API`), defaults to `true` — the mock server never checks these headers
 *    anyway, so there is nothing to gate against; this keeps every existing reveal-flow spec and
 *    screen working exactly as it did before this permission concept existed.
 * 3. Against a real backend, `NEXT_PUBLIC_ACTOR_ROLE`/`NEXT_PUBLIC_OPERATOR_TOKEN` must both be
 *    configured at build time — unset (the default) is `false`, matching NFR-04's fail-closed
 *    default rather than assuming an operator identity nobody configured.
 */
export function hasOperatorPermissions(): boolean {
  const override = readPermissionsOverride();
  if (override !== undefined) return override;
  if (MOCK_API) return true;
  return Boolean(process.env.NEXT_PUBLIC_ACTOR_ROLE && process.env.NEXT_PUBLIC_OPERATOR_TOKEN);
}

/** Dev/e2e only — mirrors `mocks/scenario.ts`'s `writeScenario`. `null` clears the override. */
export function writePermissionsOverride(granted: boolean | null): void {
  if (granted === null) window.localStorage.removeItem(PERMISSIONS_STORAGE_KEY);
  else window.localStorage.setItem(PERMISSIONS_STORAGE_KEY, granted ? "granted" : "denied");
}

export function getOperatorHeaders(): HeadersInit {
  if (!hasOperatorPermissions()) return {};
  const actorId = process.env.NEXT_PUBLIC_ACTOR_ID ?? "operator@company.co.kr";
  const actorRole = process.env.NEXT_PUBLIC_ACTOR_ROLE ?? "operator";
  const operatorToken = process.env.NEXT_PUBLIC_OPERATOR_TOKEN;
  const headers: Record<string, string> = { "X-Actor-Id": actorId, "X-Actor-Role": actorRole };
  if (operatorToken) headers["X-Operator-Token"] = operatorToken;
  return headers;
}
