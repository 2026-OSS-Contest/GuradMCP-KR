import type {
  ApiEventLookupResponse,
  ApiSessionsResponse,
  ApiSessionTimelineResponse,
  Approval,
  ApprovalDecision,
  AttackRun,
  AttackRunMode,
  AttackScenariosResponse,
  DetectDirection,
  DetectionPreview,
  EventDetail,
  ApiErrorBody,
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
} from "./types";
import {
  toEventDetailFromLookup,
  toSessionsResponse,
  toTimelineResponse,
} from "./replay-adapter";

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

async function post<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "POST",
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return (await response.json()) as T;
}

async function putJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "PUT",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
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

export const getOverview = (signal?: AbortSignal) =>
  get<Overview>("/overview", signal);
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
): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "PUT",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
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

export const getPolicy = (id: string, signal?: AbortSignal) =>
  get<PolicyDetail>(`/policies/${encodeURIComponent(id)}`, signal);
/** Reveal-original (spec §5.3 no.5): records the access in the audit log. */
export const revealEvent = (id: string, signal?: AbortSignal) =>
  post<RevealContent>(`/events/${encodeURIComponent(id)}/reveal`, signal);

// SCR-201 Attack Lab (spec §5.2).
export const getAttackScenarios = (signal?: AbortSignal) =>
  get<AttackScenariosResponse>("/attacklab/scenarios", signal);
/** Runs one scenario with the guard off or on; resolves once the run has finished. */
export const runAttackScenario = (
  id: string,
  mode: AttackRunMode,
  signal?: AbortSignal,
) =>
  post<AttackRun>(
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
 * SCR-501 Settings (spec §5.7). **No control plane serves `/settings`** — it belongs to GMCP-80,
 * so today it only ever reaches the mock. The path and verb are the ones the real endpoint will
 * use, so wiring the backend needs no change here. The screen's other write, server trust, is
 * real: see `putServerTrust`.
 */
export const getSettings = (signal?: AbortSignal) => get<GatewaySettings>("/settings", signal);

/** Each control sends only what it changed, so one never resends another's value. */
export const updateSettings = (update: SettingsUpdate, signal?: AbortSignal) =>
  putJson<GatewaySettings>("/settings", update, signal);

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
