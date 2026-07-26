/** Which of the SCR-101 Figma states the mock API should serve. */
export type ScenarioId = "full" | "empty" | "offline";

export const SCENARIOS: readonly ScenarioId[] = ["full", "empty", "offline"];

const STORAGE_KEY = "guardmcp.mock-scenario";

/** Mock the API only in development, and only when no real backend is configured. */
export const MOCK_API = process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_API_BASE_URL;

const isScenario = (value: unknown): value is ScenarioId =>
  typeof value === "string" && (SCENARIOS as readonly string[]).includes(value);

/** Read per request rather than cached, so switching takes effect without a reload. */
export function readScenario(): ScenarioId {
  if (typeof window === "undefined") return "full";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isScenario(stored) ? stored : "full";
}

export function writeScenario(id: ScenarioId): void {
  window.localStorage.setItem(STORAGE_KEY, id);
}
