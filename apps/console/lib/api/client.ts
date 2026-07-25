import type {
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
