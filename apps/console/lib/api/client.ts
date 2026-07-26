import type { Overview, RecentEventsResponse, ServersResponse } from "./types";

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

export const getOverview = (signal?: AbortSignal) => get<Overview>("/overview", signal);
export const getServers = (signal?: AbortSignal) => get<ServersResponse>("/servers", signal);
export const getRecentEvents = (signal?: AbortSignal) => get<RecentEventsResponse>("/events/recent", signal);
