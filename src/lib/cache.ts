/**
 * A small in-process TTL cache for the API routes, so a page full of
 * visitors does not turn into a page full of RPC calls. One entry per key;
 * concurrent callers share the in-flight promise.
 */
const store = new Map<string, { until: number; value: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.until > now) return hit.value as Promise<T>;
  const value = load().catch((e) => {
    store.delete(key);
    throw e;
  });
  store.set(key, { until: now + ttlMs, value });
  return value;
}
