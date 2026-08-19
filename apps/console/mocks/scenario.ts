/** Which of the SCR-101 Figma states the mock API should serve. */
export type ScenarioId = "full" | "empty" | "offline";

export const SCENARIOS: readonly ScenarioId[] = ["full", "empty", "offline"];

const STORAGE_KEY = "guardmcp.mock-scenario";

/** Mock the API only in development, and only when no real backend is configured. */
const MOCKS_WANTED =
  process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ENABLE_MOCK_API === "1";
export const MOCK_API = MOCKS_WANTED && !process.env.NEXT_PUBLIC_API_BASE_URL;

/**
 * A production build that is serving fabricated data.
 *
 * The mock gate is opt-in and documented, but a flag can still be copied into a pipeline it does
 * not belong in — and a mock-backed build is indistinguishable from a real one by looking at it.
 * So it is not left to a checklist: the status bar carries a marker whenever this is true, on
 * every screen, and the only way to remove it is to stop passing the flag. Development is
 * excluded because the flask button already says the same thing there.
 */
export const MOCK_API_IN_PRODUCTION = MOCK_API && process.env.NODE_ENV === "production";

/**
 * Whether the scenario switcher may draw itself.
 *
 * Deliberately not `MOCK_API`. AGENTS.md documents widening that gate to serve a mock-backed
 * build (`NEXT_PUBLIC_ENABLE_MOCK_API=1`), and every screen behind it is meant to be looked at by
 * someone who is not a developer — a floating flask that rewrites their console into a 미연결
 * banner is not. The switcher is a `next dev` affordance and says so in its own condition, so
 * widening the mock gate cannot drag it along. The scenario itself still reads from localStorage,
 * which is how the e2e suite drives the empty and offline states.
 */
export const SHOW_SCENARIO_SWITCHER = process.env.NODE_ENV === "development" && MOCK_API;

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
