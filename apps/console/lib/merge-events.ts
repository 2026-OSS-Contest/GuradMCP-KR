/**
 * Merge streamed and polled events into one newest-first, de-duplicated, capped list.
 *
 * The same event can arrive twice — once pushed over SSE, once in a later `/events/recent`
 * poll — so ids are de-duplicated to a single row (the two copies carry the same data, so which
 * one is retained does not matter). With `getTime` the result is sorted newest-first (a recovery
 * poll can carry events older than ones already streamed); without it, `incoming` leads `prev` in
 * insertion order so a fresh stream event lands on top. The list is then capped to `max`.
 */
export interface MergeOptions<T> {
  getId: (item: T) => string;
  getTime?: (item: T) => number;
  max: number;
}

export function mergeEvents<T>(prev: T[], incoming: T[], options: MergeOptions<T>): T[] {
  const { getId, getTime, max } = options;

  const byId = new Map<string, T>();
  for (const item of [...incoming, ...prev]) {
    const id = getId(item);
    if (!byId.has(id)) byId.set(id, item);
  }

  const list = [...byId.values()];
  if (getTime) list.sort((a, b) => getTime(b) - getTime(a));
  return list.slice(0, max);
}
