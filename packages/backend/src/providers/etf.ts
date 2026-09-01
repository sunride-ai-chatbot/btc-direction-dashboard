import { readFile } from 'node:fs/promises';
import { FRESHNESS_LIMITS_MS } from '../config.js';
import type { EtfFlows } from '../types.js';

export interface EtfProvider {
  fetchFlows(): Promise<EtfFlows>;
}

/**
 * No reliable free real-time ETF flow API exists.
 * This provider reads an optional manually-maintained JSON file
 * (data/etf-flows.json). If absent or stale, it honestly reports unavailable.
 * NEVER fabricates values.
 *
 * Expected file format:
 * { "updatedAt": "2026-09-01T12:00:00Z", "dailyFlowsUsd": [{ "date": "2026-08-29", "netFlow": 125000000 }, ...] }
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

      const flows = [...parsed.dailyFlowsUsd]
        .filter((f) => Number.isFinite(f.netFlow))
        .sort((a, b) => b.date.localeCompare(a.date));
      if (flows.length === 0) throw new Error('no flow rows');

      const age = now - updatedAt;
      const freshness = age > FRESHNESS_LIMITS_MS.etf ? 'stale' : 'fresh';

      return {
        netFlowToday: flows[0]?.netFlow ?? null,
        netFlowPrevDay: flows[1]?.netFlow ?? null,
        rolling3Day: rollingSum(flows, 3),
        rolling5Day: rollingSum(flows, 5),
        source: `manual-file (${parsed.updatedAt})`,
        timestamp: updatedAt,
        freshness,
        available: true,
      };
    } catch {
      return {
        netFlowToday: null,
        netFlowPrevDay: null,
        rolling3Day: null,
        rolling5Day: null,
        source: 'etf-manual-file',
        timestamp: now,
        freshness: 'unavailable',
        available: false,
      };
    }
  }
}

function rollingSum(flows: Array<{ netFlow: number }>, days: number): number | null {
  if (flows.length < days) return null;
  return flows.slice(0, days).reduce((a, f) => a + f.netFlow, 0);
}
