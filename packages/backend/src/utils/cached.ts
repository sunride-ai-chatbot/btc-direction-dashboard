/**
 * Wraps an async fetcher with a TTL cache so the pipeline can run frequently
 * while each upstream API is only hit at its configured refresh interval.
 * On error after expiry, returns the previous value if one exists (provider
 * fallback logic handles freshness labeling internally anyway).
 */
export function cached<T>(fn: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let value: T | undefined;
  let fetchedAt = 0;
  let inflight: Promise<T> | null = null;

  return async () => {
    const now = Date.now();
    if (value !== undefined && now - fetchedAt < ttlMs) return value;
    if (inflight) return inflight;

    inflight = fn()
      .then((v) => {
        value = v;
        fetchedAt = Date.now();
        return v;
      })
      .catch((err) => {
        if (value !== undefined) return value;
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
