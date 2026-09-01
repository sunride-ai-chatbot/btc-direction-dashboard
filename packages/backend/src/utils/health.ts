import type { Freshness, ProviderHealth } from '../types.js';

interface HealthEntry {
  lastSuccessTs: number | null;
  lastLatencyMs: number | null;
  consecutiveFailures: number;
  totalFailures: number;
  freshness: Freshness;
  note: string | null;
}

/**
 * In-process provider health registry. Counters reset on restart (noted in the
 * payload via processStartTs); last-successful-update also survives implicitly
 * in the data each provider persisted.
 */
export class HealthRegistry {
  private entries = new Map<string, HealthEntry>();
  readonly processStartTs = Date.now();

  private entry(name: string): HealthEntry {
    let e = this.entries.get(name);
    if (!e) {
      e = { lastSuccessTs: null, lastLatencyMs: null, consecutiveFailures: 0, totalFailures: 0, freshness: 'unavailable', note: null };
      this.entries.set(name, e);
    }
    return e;
  }

  /** Wraps a provider fetch: records latency, success/failure, and reported freshness. */
  instrument<T extends { freshness: Freshness }>(name: string, fn: () => Promise<T>): () => Promise<T> {
    return async () => {
      const e = this.entry(name);
      const start = Date.now();
      try {
        const result = await fn();
        e.lastLatencyMs = Date.now() - start;
        e.freshness = result.freshness;
        if (result.freshness === 'fresh') {
          e.lastSuccessTs = Date.now();
          e.consecutiveFailures = 0;
          e.note = null;
        } else if (result.freshness === 'unavailable') {
          // Provider returned its honest fallback shape — counts as a failed refresh.
          e.consecutiveFailures++;
          e.totalFailures++;
        }
        return result;
      } catch (err) {
        e.consecutiveFailures++;
        e.totalFailures++;
        e.lastLatencyMs = Date.now() - start;
        e.note = err instanceof Error ? err.message.slice(0, 120) : 'unknown error';
        throw err;
      }
    };
  }

  /** Manual note for providers with special semantics (e.g. daily series, manual files). */
  annotate(name: string, note: string): void {
    this.entry(name).note = note;
  }

  snapshot(cadence: Record<string, 'realtime' | 'daily' | 'manual'>): { processStartTs: number; providers: ProviderHealth[] } {
    const providers: ProviderHealth[] = [];
    for (const [name, e] of this.entries) {
      providers.push({
        name,
        status: statusOf(e, cadence[name] ?? 'realtime'),
        lastSuccessTs: e.lastSuccessTs,
        lastLatencyMs: e.lastLatencyMs,
        consecutiveFailures: e.consecutiveFailures,
        totalFailures: e.totalFailures,
        freshness: e.freshness,
        note: e.note,
      });
    }
    return { processStartTs: this.processStartTs, providers };
  }
}

function statusOf(e: HealthEntry, cadence: 'realtime' | 'daily' | 'manual'): ProviderHealth['status'] {
  if (cadence === 'manual') {
    return e.freshness === 'unavailable' ? 'UNAVAILABLE' : e.freshness === 'stale' ? 'STALE' : 'LIVE';
  }
  if (e.freshness === 'unavailable') return 'DOWN';
  if (e.freshness === 'stale' || e.consecutiveFailures > 0) return 'DEGRADED';
  return cadence === 'daily' ? 'DAILY' : 'LIVE';
}
