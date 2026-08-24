import type {
  ApiOverview,
  ApiErrorBody,
  ApiEventLookupResponse,
  ApiSessionTimelineResponse,
  ApiSessionsResponse,
  Approval,
  ApprovalDecision,
  AttackRunResponse,
  AttackRunMode,
  AttackScenariosResponse,
  BenchmarkReport,
  BenchmarkSamplesResponse,
  DetectDirection,
  DetectionPreview,
  EventDetail,
  GatewaySettings,
  Overview,
  PolicyDetail,
  PolicyPack,
  PolicyRow,
  PolicyStats,
  RecentEventsResponse,
  RevealContent,
  ServerTrustChangeRequest,
  ServerTrustChangeResult,
  ServersResponse,
  SessionsResponse,
  SettingsUpdate,
  TimelineResponse,
  ToolDefinitionDiff,
  ToolDiffsResponse
} from "./types";
import { toOverview } from "./overview-adapter";
import {
  toEventDetailFromLookup,
  toSessionsResponse,
  toTimelineResponse,
} from "./replay-adapter";
import { getOperatorHeaders } from "./permissions";

/** Empty in development, where MSW answers these same-origin requests. */
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  /** Parsed JSON error body, when the response had one — e.g. the trust-upgrade 409's `details`. */
  constructor(
    readonly status: number,
    statusText: string,
    readonly body?: ApiErrorBody,
  ) {
    super(`${status} ${statusText}`);
    this.name = "ApiError";
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return (await response.json()) as T;
}

async function post<T>(path: string, signal?: AbortSignal, extraHeaders?: HeadersInit): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "POST",
    signal,
    headers: { Accept: "application/json", ...extraHeaders },
  });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return (await response.json()) as T;
}

async function putJson<T>(path: string, body: unknown, signal?: AbortSignal, extraHeaders?: HeadersInit): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "PUT",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return (await response.json()) as T;
}

async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "POST",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return (await response.json()) as T;
}

/** `/overview` answers a different shape than the screens read — see `overview-adapter.ts`. */
export const getOverview = (signal?: AbortSignal): Promise<Overview> =>
  get<ApiOverview>("/overview", signal).then(toOverview);
export const getServers = (signal?: AbortSignal) =>
  get<ServersResponse>("/servers", signal);
export const getRecentEvents = (signal?: AbortSignal) =>
  get<RecentEventsResponse>("/events/recent", signal);
export const getSessions = (signal?: AbortSignal): Promise<SessionsResponse> =>
  get<ApiSessionsResponse>("/sessions", signal).then(toSessionsResponse);
export const getSessionTimeline = (
  id: string,
  signal?: AbortSignal,
): Promise<TimelineResponse> =>
  get<ApiSessionTimelineResponse>(
    `/sessions/${encodeURIComponent(id)}/timeline`,
    signal,
  ).then(toTimelineResponse);
/** Deep-link support (spec §3.3): paints the detail panel without loading the full timeline first. */
export const getEvent = (
  id: string,
  signal?: AbortSignal,
): Promise<EventDetail> =>
  get<ApiEventLookupResponse>(`/events/${encodeURIComponent(id)}`, signal).then(
    toEventDetailFromLookup,
  );

async function put<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  extraHeaders?: HeadersInit,
): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "PUT",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new ApiError(
      response.status,
      response.statusText,
      payload as ApiErrorBody | undefined,
    );
  return payload as T;
}

/** FR-GW-02 §5.1: throws ApiError(409) with `body.details` when an upgrade needs `confirmed: true`. */
export const putServerTrust = (
  id: string,
  request: ServerTrustChangeRequest,
  signal?: AbortSignal,
) =>
  put<ServerTrustChangeResult>(
    `/servers/${encodeURIComponent(id)}/trust`,
    request,
    signal,
  );

/** SCR-101 snapshot diff popover (FR-GW-03 §6.2). Unacknowledged diffs, most recent first,
 *  unless `includeAcknowledged` — the `drift_acknowledged` state has no unacknowledged rows
 *  left to show, so the popover needs the full history to explain what was dismissed. */
export const getToolDiffs = (
  serverId: string,
  toolName: string,
  signal?: AbortSignal,
  includeAcknowledged = false,
) =>
  get<ToolDiffsResponse>(
    `/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}/diffs${includeAcknowledged ? "?includeAcknowledged=true" : ""}`,
    signal,
  );

/** FR-GW-03 §6.3: marks a diff confirmed. Does not change the approved baseline. */
export const acknowledgeToolDiff = (
  serverId: string,
  toolName: string,
  diffId: string,
  signal?: AbortSignal,
) =>
  postJson<ToolDefinitionDiff>(
    `/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}/diffs/${encodeURIComponent(diffId)}/acknowledge`,
    {},
    signal,
  );

/** FR-GW-03 §5.1.4 false-positive path: re-approves one tool from its latest reported
 *  observation, replacing `acknowledgeToolDiff`'s "dismiss the notice" with "make the
 *  current definition the approved one" — the only way `snapshotStatus.state` actually
 *  returns to `in_sync` after a real (non-false-positive) change. */
export const reapproveTool = (
  serverId: string,
  toolName: string,
  signal?: AbortSignal,
) =>
  postJson<{ approved: boolean; tools: Array<{ toolName: string; description: string }> }>(
    `/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}/reapprove`,
    {},
    signal,
  );

/** fix-api.md §4: the raw YAML behind a policy id, at `/source` rather than `/policies/{id}`
 *  itself — that path is already spoken for by `PUT /policies/{id}` (the action/severity/
 *  priority override), so a GET there would be asymmetric with what the PUT means. */
export const getPolicy = (id: string, signal?: AbortSignal) =>
  get<PolicyDetail>(`/policies/${encodeURIComponent(id)}/source`, signal);
/**
 * Reveal-original (GMCP-84 §6.3): records the access in the audit log. Carries the operator
 * headers `getOperatorHeaders` builds — without them the control plane's `PermissionService`
 * 403s regardless of what the UI decided to show (§7).
 */
export const revealEvent = (id: string, signal?: AbortSignal) =>
  post<RevealContent>(`/events/${encodeURIComponent(id)}/reveal`, signal, getOperatorHeaders());

// SCR-201 Attack Lab (spec §5.2).
export const getAttackScenarios = (signal?: AbortSignal) =>
  get<AttackScenariosResponse>("/attacklab/scenarios", signal);
/**
 * Runs one scenario with the guard off or on.
 *
 * Under the mocks this resolves with the finished run. A real control plane answers 202 with a
 * receipt instead — see `AttackRunQueued` — so the caller has to narrow before reading any of
 * the evidence. `?mode=` is sent for the mock's benefit; `AttackLabController.run` declares no
 * such parameter and drops it.
 */
export const runAttackScenario = (
  id: string,
  mode: AttackRunMode,
  signal?: AbortSignal,
): Promise<AttackRunResponse> =>
  post<AttackRunResponse>(
    `/attacklab/run/${encodeURIComponent(id)}?mode=${mode}`,
    signal,
  );

/**
 * SCR-401 Detector (spec §5.4). The control plane serves this one for real. `direction` rides
 * as a query parameter rather than in the body: the endpoint does not read it yet and an unknown
 * body field would be rejected, whereas an unbound query parameter is simply ignored.
 */
export const previewDetection = (
  text: string,
  direction: DetectDirection,
  signal?: AbortSignal,
) =>
  postJson<DetectionPreview>(
    `/detect/preview?direction=${direction}`,
    { text },
    signal,
  );

/**
 * SCR-402 Approval Console (spec §5.6), served by the control plane today.
 *
 * The endpoint answers with a bare JSON array, not an envelope, and its `status` filter only
 * accepts one `ApprovalStatus` at a time — there is no `resolved` bucket covering the four
 * terminal ones. So the screen asks once, unfiltered, and splits the list itself.
 */
export const getApprovals = (signal?: AbortSignal) =>
  get<Approval[]>("/approvals", signal);

/**
 * SCR-501 Settings (spec §5.7). Served for real by GMCP-68's `SettingsController`; MSW still
 * answers it in development (`mocks/settings.ts`) whenever `NEXT_PUBLIC_API_BASE_URL` is unset.
 */
export const getSettings = (signal?: AbortSignal) => get<GatewaySettings>("/settings", signal);

/**
 * Each control sends only what it changed, so one never resends another's value.
 *
 * `rawPayloadStorageEnabled` additionally carries the operator headers (GMCP-84 §7): the control
 * plane requires `settings:write` only for that one field, so every other field-only update
 * (failMode, locale, approvalTimeoutSeconds) keeps working with no headers at all, exactly as
 * before.
 */
export const updateSettings = (update: SettingsUpdate, signal?: AbortSignal) =>
  put<GatewaySettings>(
    "/settings",
    update,
    signal,
    update.rawPayloadStorageEnabled !== undefined ? getOperatorHeaders() : undefined,
  );

// Retuning an upstream's trust tier goes through `putServerTrust` above — FR-GW-02's real
// `PUT /servers/{id}/trust`, not the `PUT /servers/{id}` an earlier reading here assumed while
// the endpoint was still unbuilt.

/**
 * Resolve a held call. Throws `ApiError` with status 409 when someone else — or the 120s
 * timeout — got there first, which the screen reports rather than retrying.
 */
export const decideApproval = (id: string, decision: ApprovalDecision, signal?: AbortSignal) =>
  postJson<Approval>(`/approvals/${encodeURIComponent(id)}/decision`, { decision }, signal);

/**
 * SCR-302 Policy Builder (spec §5.5), served by the control plane today.
 *
 * Packs and policies are two endpoints, not one payload, and each answers with a bare array —
 * so the screen asks for both and joins them on `packId` itself.
 */
export const getPolicyPacks = (signal?: AbortSignal) => get<PolicyPack[]>("/policy-packs", signal);
export const getPolicies = (signal?: AbortSignal) => get<PolicyRow[]>("/policies", signal);

/** Flip a whole pack. The one policy mutation the control plane fully supports. */
export const setPackEnabled = (id: string, enabled: boolean, signal?: AbortSignal) =>
  putJson<PolicyPack>(`/policy-packs/${encodeURIComponent(id)}`, { enabled }, signal);


/**
 * Flip one policy on or off.
 *
 * The path and verb are the real ones, but `enabled` is **not** a field
 * `PolicyUpdateRequest` declares, so a real control plane accepts the call and changes nothing.
 * Only the mock honours it. Until the control plane grows the field, this is the SCR-302 toggle
 * the design asks for and nothing more.
 */
export const setPolicyEnabled = (id: string, enabled: boolean, signal?: AbortSignal) =>
  putJson<PolicyRow>(`/policies/${encodeURIComponent(id)}`, { enabled }, signal);

/**
 * How often one policy fired, and what it would have decided in dry-run. GMCP-80 defines this
 * path; nothing serves it yet, so today it only ever reaches the mock.
 */
export const getPolicyStats = (id: string, signal?: AbortSignal) =>
  get<PolicyStats>(`/policies/${encodeURIComponent(id)}/stats`, signal);

/**
 * The benchmark report (GMCP-61). `attack-lab/benchmark/run.ts` produces it; nothing serves it
 * yet, so this reaches only the mock. The path is the one the console asks the control plane for.
 */
export const getBenchmarkReport = (signal?: AbortSignal) => get<BenchmarkReport>("/benchmark/report", signal);

/**
 * The samples the report was measured on, each already judged. The report itself carries only
 * aggregates for these, so a per-sample verdict has to come from here — see the note in types.ts.
 */
export const getBenchmarkSamples = (signal?: AbortSignal) =>
  get<BenchmarkSamplesResponse>("/benchmark/samples", signal);
