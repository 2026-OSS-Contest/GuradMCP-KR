import type {
  Approval,
  ApprovalDecision,
  ApprovalsResponse,
  AttackRun,
  AttackRunMode,
  AttackScenariosResponse,
  DetectDirection,
  DetectionPreview,
  Overview,
  PolicyDetail,
  RecentEventsResponse,
  RevealContent,
  ServersResponse,
  SessionsResponse,
  TimelineResponse
} from "./types";

/** Empty in development, where MSW answers these same-origin requests. */
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(readonly status: number, statusText: string) {
    super(`${status} ${statusText}`);
    this.name = "ApiError";
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return (await response.json()) as T;
}

async function post<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, { method: "POST", signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "POST",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return (await response.json()) as T;
}

export const getOverview = (signal?: AbortSignal) => get<Overview>("/overview", signal);
export const getServers = (signal?: AbortSignal) => get<ServersResponse>("/servers", signal);
export const getRecentEvents = (signal?: AbortSignal) => get<RecentEventsResponse>("/events/recent", signal);
export const getSessions = (signal?: AbortSignal) => get<SessionsResponse>("/sessions", signal);
export const getSessionTimeline = (id: string, signal?: AbortSignal) =>
  get<TimelineResponse>(`/sessions/${encodeURIComponent(id)}/timeline`, signal);
export const getPolicy = (id: string, signal?: AbortSignal) =>
  get<PolicyDetail>(`/policies/${encodeURIComponent(id)}`, signal);
/** Reveal-original (spec §5.3 no.5): records the access in the audit log. */
export const revealEvent = (id: string, signal?: AbortSignal) =>
  post<RevealContent>(`/events/${encodeURIComponent(id)}/reveal`, signal);

// SCR-201 Attack Lab (spec §5.2).
export const getAttackScenarios = (signal?: AbortSignal) =>
  get<AttackScenariosResponse>("/attacklab/scenarios", signal);
/** Runs one scenario with the guard off or on; resolves once the run has finished. */
export const runAttackScenario = (id: string, mode: AttackRunMode, signal?: AbortSignal) =>
  post<AttackRun>(`/attacklab/run/${encodeURIComponent(id)}?mode=${mode}`, signal);

/**
 * SCR-401 Detector (spec §5.4). The control plane serves this one for real. `direction` rides
 * as a query parameter rather than in the body: the endpoint does not read it yet and an unknown
 * body field would be rejected, whereas an unbound query parameter is simply ignored.
 */
export const previewDetection = (text: string, direction: DetectDirection, signal?: AbortSignal) =>
  postJson<DetectionPreview>(`/detect/preview?direction=${direction}`, { text }, signal);

// SCR-402 Approval Console (spec §5.6), served by the control plane today.
export const getApprovals = (status: "pending" | "resolved", signal?: AbortSignal) =>
  get<ApprovalsResponse>(`/approvals?status=${status}`, signal);

/**
 * Resolve a held call. Throws `ApiError` with status 409 when someone else — or the 120s
 * timeout — got there first, which the screen reports rather than retrying.
 */
export const decideApproval = (id: string, decision: ApprovalDecision, signal?: AbortSignal) =>
  postJson<Approval>(`/approvals/${encodeURIComponent(id)}/decision`, { decision }, signal);
