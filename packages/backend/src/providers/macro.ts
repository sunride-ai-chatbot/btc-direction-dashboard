import { readFile } from 'node:fs/promises';
import { fetchText } from '../utils/fetchJson.js';
import type { MacroData } from '../types.js';

export interface MacroProvider {
  fetchMacro(): Promise<MacroData>;
}

/**
 * Free macro data from FRED's public CSV export (no API key):
 *   DTWEXBGS — Fed broad trade-weighted dollar index (public-domain stand-in for DXY)
 *   DGS2 / DGS10 — official 2Y / 10Y Treasury yields
 * These are DAILY series published with ~1 business-day lag; freshness reflects the
 * observation date. Fed-cut expectations are derived from Polymarket fed markets by
 * the pipeline, not fetched here. Missing values are reported null, never fabricated.
 */
export class FredMacroProvider implements MacroProvider {
  private lastGood: MacroData | null = null;
  private base = process.env.FRED_CSV_URL ?? 'https://fred.stlouisfed.org/graph/fredgraph.csv';

  constructor(private eventsFile: string = process.env.MACRO_EVENTS_FILE ?? './data/macro-events.json') {}

  async fetchMacro(): Promise<MacroData> {
    const now = Date.now();
    const [dollar, us2y, us10y, events] = await Promise.all([
      this.fredSeries('DTWEXBGS'),
      this.fredSeries('DGS2'),
      this.fredSeries('DGS10'),
      this.loadEvents(),
    ]);

    const anyData = dollar !== null || us2y !== null || us10y !== null;
    if (!anyData) {
      if (this.lastGood) {
        const ageMs = now - this.lastGood.timestamp;
        return { ...this.lastGood, freshness: ageMs > 6 * 3_600_000 ? 'unavailable' : 'stale' };
      }
      return {
        dxy: null, dxyChange24h: null, us2y: null, us10y: null,
        fedCutProbability: null, cpiContext: null, upcomingEvents: events,
        source: 'fred-csv', timestamp: now, freshness: 'unavailable', available: false,
      };
    }

    const newestDate = [dollar, us2y, us10y]
      .filter((s): s is FredSeries => s !== null)
      .map((s) => s.latestDate)
      .sort()
      .at(-1)!;
    const ageDays = (now - Date.parse(newestDate)) / 86_400_000;

    const result: MacroData = {
      dxy: dollar?.latest ?? null,
      dxyChange24h: dollar?.dayChangePct ?? null,
      us2y: us2y?.latest ?? null,
      us10y: us10y?.latest ?? null,
      fedCutProbability: null,
      cpiContext: null,
      upcomingEvents: events,
      source: `fred-csv (obs ${newestDate})`,
      timestamp: now,
      freshness: ageDays > 5 ? 'stale' : 'fresh',
      available: true,
    };
    this.lastGood = result;
    return result;
  }

  private async fredSeries(id: string): Promise<FredSeries | null> {
    try {
      const startDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const csv = await fetchText(`${this.base}?id=${id}&cosd=${startDate}`, { retries: 1, timeoutMs: 12_000 });
      const rows = csv
        .trim()
        .split('\n')
        .slice(1)
        .map((line) => {
          const [date, value] = line.split(',');
          return { date, value: Number.parseFloat(value) };
        })
        .filter((r) => Number.isFinite(r.value));
      if (rows.length === 0) return null;
      const latest = rows[rows.length - 1];
      const prev = rows[rows.length - 2];
      return {
        latest: latest.value,
        latestDate: latest.date,
        dayChangePct: prev ? ((latest.value - prev.value) / prev.value) * 100 : null,
      };
    } catch {
      return null;
    }
  }

  private async loadEvents(): Promise<Array<{ name: string; date: string }>> {
    try {
      const raw = await readFile(this.eventsFile, 'utf8');
      const parsed = JSON.parse(raw) as { events: Array<{ name: string; date: string }> };
      const today = new Date().toISOString().slice(0, 10);
      return parsed.events
        .filter((e) => e.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 5);
    } catch {
      return [];
    }
  }
}

interface FredSeries {
  latest: number;
  latestDate: string;
  dayChangePct: number | null;
}
