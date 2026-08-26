/** A canonical UUID: 8-4-4-4-12 hex, which is what the control plane keys sessions by. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether an id is in the control plane's own key space, as opposed to a fixture's slug. */
export function isUuid(id: string): boolean {
  return UUID.test(id);
}

/**
 * The same rule for any of the control plane's ids — events are keyed by `UUID` too, and the
 * reveal modal's source line has no more room for 36 characters than the status bar does.
 */
export function displayId(id: string): string {
  return UUID.test(id) ? id.slice(0, 8) : id;
}

/**
 * How a session id is *shown*, as opposed to how it is passed around.
 *
 * `ReplayController` keys sessions by `UUID`, so a real backend answers 36 characters where the
 * fixtures answer `s-0712`. Both fit — the label truncates — but a truncated UUID is 30-odd
 * characters of noise in a status bar that has one line, and the reader cannot tell where the id
 * ends and the ellipsis begins.
 *
 * So a UUID is shortened to its first group, the same eight characters git shows for a commit,
 * and anything that is not a UUID is left exactly as it is: the fixtures' ids are already short
 * and meaningful, and truncating `s-0712` to `s-071` would invent an ambiguity that is not there.
 *
 * Only ever for display. The full id stays in the URL, the fetch and the `title`, because a
 * shortened id is not a session id and nothing should be looked up by it.
 */
export const displaySessionId = displayId;
