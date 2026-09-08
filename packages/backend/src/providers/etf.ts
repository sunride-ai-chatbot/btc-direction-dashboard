import { readFile } from 'node:fs/promises';
import { fetchJson } from '../utils/fetchJson.js';
import { FRESHNESS_LIMITS_MS } from '../config.js';
import type { EtfFlows } from '../types.js';
import type { SignalDatabase } from '../db/database.js';

export interface EtfProvider {
  fetchFlows(): Promise<EtfFlows>;
}

/** ETF flow data is DAILY (trading days): fresh while the newest observation is this recent. */
const MAX_FRESH_DATA_AGE_DAYS = 5;
/** DB fallback stays usable (marked stale) up to this age, then honestly unavailable. */
const MAX_STALE_DATA_AGE_DAYS = 14;

export interface DailyFlowRow {
  date: string;
  netFlow: number;
}

/**
 * Pure computation: aggregate trading-day rows (newest-first) into the EtfFlows shape.
 * "PrevDay" means previous TRADING day; rolling windows are trading days, not calendar days.
 * Never invents rows — insufficient history yields nulls.
 */
export function computeEtfFlows(rows: DailyFlowRow[], source: string, now: number, freshness: EtfFlows['freshness']): EtfFlows {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const sum = (n: number): number | null =>
    sorted.length >= n ? sorted.slice(0, n).reduce((a, r) => a + r.netFlow, 0) : null;
  return {
    netFlowToday: sorted[0]?.netFlow ?? null,
    netFlowPrevDay: sorted[1]?.netFlow ?? null,
    rolling3Day: sum(3),
    rolling5Day: sum(5),
    dataDate: sorted[0]?.date ?? null,
    source,
    timestamp: now,
    freshness,
    available: sorted.length > 0,
  };
}

export function dataAgeDays(dataDate: string, now: number): number {
  return (now - Date.parse(dataDate + 'T00:00:00Z')) / 86_400_000;
}

interface SosoRow {
  date: string;
  totalNetInflow: number;
}

/**
 * US spot Bitcoin ETF daily net flows from SoSoValue's public open API
 * (aggregate across IBIT/FBTC/GBTC/ARKB/BITB/etc. — the scoring engine needs
 * the aggregate). Every successful fetch is persisted to etf_flow_history so
 * the app builds its own dataset and can serve last-known values (marked
 * STALE, never fabricated) when the source is down.
 */
export class SosoValueEtfProvider implements EtfProvider {
  private base = process.env.SOSOVALUE_API_URL ?? 'https://api.sosovalue.xyz';

  constructor(private db: SignalDatabase) {}

  async fetchFlows(): Promise<EtfFlows> {
    const now = Date.now();
    try {
      const response = await fetchJson<{ code: number; data: SosoRow[] }>(
        `${this.base}/openapi/v2/etf/historicalInflowChart`,
        {
          timeoutMs: 15_000,
          retries: 2,
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          body: JSON.stringify({ type: 'us-btc-spot' }),
        },
      );
      if (response.code !== 0 || !Array.isArray(response.data) || response.data.length === 0) {
        throw new Error(`sosovalue payload code=${response.code}`);
      }
      const rows: DailyFlowRow[] = response.data
        .filter((r) => typeof r.date === 'string' && Number.isFinite(r.totalNetInflow))
        .slice(0, 15)
        .map((r) => ({ date: r.date, netFlow: r.totalNetInflow }));
      if (rows.length === 0) throw new Error('sosovalue returned no usable rows');

      this.db.upsertEtfFlows(rows.map((r) => ({ date: r.date, netFlow: r.netFlow, source: 'sosovalue' })), now);

      const newest = rows.reduce((a, b) => (a.date > b.date ? a : b));
      const freshness = dataAgeDays(newest.date, now) <= MAX_FRESH_DATA_AGE_DAYS ? 'fresh' : 'stale';
      return computeEtfFlows(rows, 'sosovalue (us-btc-spot aggregate)', now, freshness);
    } catch (err) {
      return this.fallbackFromDb(now, err instanceof Error ? err.message : 'fetch failed');
    }
  }

  /** Source down: serve our own persisted history, marked stale — never zeros. */
  private fallbackFromDb(now: number, reason: string): EtfFlows {
    const stored = this.db.getRecentEtfFlows(6);
    if (stored.length > 0) {
      const ageDays = dataAgeDays(stored[0].date, now);
      if (ageDays <= MAX_STALE_DATA_AGE_DAYS) {
        console.error('[etf] source unreachable (' + reason + ') — serving last-known data from', stored[0].date);
        return computeEtfFlows(
          stored.map((r) => ({ date: r.date, netFlow: r.net_flow })),
          `sosovalue (cached ${stored[0].date})`,
          now,
          'stale',
        );
      }
    }
    return {
      netFlowToday: null, netFlowPrevDay: null, rolling3Day: null, rolling5Day: null,
      dataDate: null, source: 'sosovalue', timestamp: now, freshness: 'unavailable', available: false,
    };
  }
}

/**
 * Manual-file provider (legacy/override via ETF_SOURCE=manual): reads
 * data/etf-flows.json maintained by hand. Kept as an escape hatch; NEVER fabricates.
 */
export class ManualFileEtfProvider implements EtfProvider {
  constructor(private filePath: string = process.env.ETF_FLOWS_FILE ?? './data/etf-flows.json') {}

  async fetchFlows(): Promise<EtfFlows> {
    const now = Date.now();
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        updatedAt: string;
        dailyFlowsUsd: Array<{ date: string; netFlow: number }>;
      };
      const updatedAt = Date.parse(parsed.updatedAt);
      if (!Number.isFinite(updatedAt)) throw new Error('invalid updatedAt');

      const flows = parsed.dailyFlowsUsd.filter((f) => Number.isFinite(f.netFlow));
      if (flows.length === 0) throw new Error('no flow rows');

      const freshness = now - updatedAt > FRESHNESS_LIMITS_MS.etf ? 'stale' : 'fresh';
      return computeEtfFlows(flows, `manual-file (${parsed.updatedAt})`, now, freshness);
    } catch {
      return {
        netFlowToday: null, netFlowPrevDay: null, rolling3Day: null, rolling5Day: null,
        dataDate: null, source: 'etf-manual-file', timestamp: now, freshness: 'unavailable', available: false,
      };
    }
  }
}
