/**
 * Wall-clock `HH:MM`. The locale is pinned rather than taken from the UI language because the
 * design draws a 24-hour clock on every screen, and a Korean locale would render "오후 2:02".
 */
export function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
