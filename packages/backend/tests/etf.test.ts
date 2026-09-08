import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalDatabase } from '../src/db/database.js';
import { computeEtfFlows, dataAgeDays, SosoValueEtfProvider } from '../src/providers/etf.js';
import { scoreEtf } from '../src/scoring/scorers.js';

const NOW = Date.parse('2026-09-01T18:00:00Z');

const ROWS = [
  { date: '2026-08-31', netFlow: 216_702_053 },
  { date: '2026-08-28', netFlow: -50_000_000 },
  { date: '2026-08-27', netFlow: 120_000_000 },
  { date: '2026-08-26', netFlow: 80_000_000 },
  { date: '2026-08-25', netFlow: -30_000_000 },
  { date: '2026-08-24', netFlow: 10_000_000 },
];

describe('computeEtfFlows (parsing/aggregation)', () => {
  it('aggregates trading-day rows into latest/prev/rolling windows', () => {
    const flows = computeEtfFlows(ROWS, 'test', NOW, 'fresh');
    expect(flows.netFlowToday).toBe(216_702_053);
    expect(flows.netFlowPrevDay).toBe(-50_000_000);
    expect(flows.rolling3Day).toBe(216_702_053 - 50_000_000 + 120_000_000);
    expect(flows.rolling5Day).toBe(216_702_053 - 50_000_000 + 120_000_000 + 80_000_000 - 30_000_000);
    expect(flows.dataDate).toBe('2026-08-31');
    expect(flows.available).toBe(true);
  });

  it('sorts unordered input and never invents missing windows', () => {
    const shuffled = [ROWS[2], ROWS[0], ROWS[1]];
    const flows = computeEtfFlows(shuffled, 'test', NOW, 'fresh');
    expect(flows.dataDate).toBe('2026-08-31');
    expect(flows.rolling3Day).not.toBeNull();
    expect(flows.rolling5Day).toBeNull();
  });

  it('computes data age in days', () => {
    expect(dataAgeDays('2026-08-31', NOW)).toBeCloseTo(1.75, 2);
    expect(dataAgeDays('2026-08-20', NOW)).toBeGreaterThan(12);
  });
});

describe('SosoValueEtfProvider', () => {
  let db: SignalDatabase;
  beforeEach(() => {
    db = new SignalDatabase(':memory:');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  function mockFetchOnce(payload: unknown, ok = true): void {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => payload,
    })) as unknown as typeof fetch);
  }

  it('fetches, persists to etf_flow_history, and reports fresh DAILY data', async () => {
    mockFetchOnce({ code: 0, data: ROWS.map((r) => ({ date: r.date, totalNetInflow: r.netFlow })) });
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const provider = new SosoValueEtfProvider(db);
    const flows = await provider.fetchFlows();
    expect(flows.available).toBe(true);
    expect(flows.freshness).toBe('fresh');
    expect(flows.netFlowToday).toBe(216_702_053);
    expect(flows.dataDate).toBe('2026-08-31');
    expect(db.getRecentEtfFlows(10)).toHaveLength(6);
    expect(db.getRecentEtfFlows(1)[0].date).toBe('2026-08-31');
  });

  it('marks aging data stale instead of calling it fresh', async () => {
    const OLD = [{ date: '2026-08-20', totalNetInflow: 5_000_000 }];
    mockFetchOnce({ code: 0, data: OLD });
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const flows = await new SosoValueEtfProvider(db).fetchFlows();
    expect(flows.available).toBe(true);
    expect(flows.freshness).toBe('stale');
  });

  it('on source failure serves last-known persisted values marked STALE — never zeros', async () => {
    db.upsertEtfFlows(ROWS.map((r) => ({ date: r.date, netFlow: r.netFlow, source: 'sosovalue' })), NOW);
    mockFetchOnce({}, false);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const flows = await new SosoValueEtfProvider(db).fetchFlows();
    expect(flows.available).toBe(true);
    expect(flows.freshness).toBe('stale');
    expect(flows.netFlowToday).toBe(216_702_053);
    expect(flows.source).toContain('cached');
  });

  it('reports unavailable when the source fails and no history exists', async () => {
    mockFetchOnce({}, false);
    const flows = await new SosoValueEtfProvider(db).fetchFlows();
    expect(flows.available).toBe(false);
    expect(flows.freshness).toBe('unavailable');
    expect(flows.netFlowToday).toBeNull();
  });

  it('rejects malformed payloads and falls back honestly', async () => {
    mockFetchOnce({ code: 1, data: 'nope' });
    const flows = await new SosoValueEtfProvider(db).fetchFlows();
    expect(flows.available).toBe(false);
  });
});

describe('ETF component integration (existing scorer, unchanged weights)', () => {
  it('real flows feed the existing scorer and produce a directional score', () => {
    const flows = computeEtfFlows(ROWS, 'sosovalue', NOW, 'fresh');
    const comp = scoreEtf(flows);
    expect(comp.available).toBe(true);
    expect(comp.score).toBeGreaterThan(0);
    expect(comp.details.dataDate).toBe('2026-08-31');
  });

  it('stale flows still score but carry a staleness risk', () => {
    const flows = computeEtfFlows(ROWS, 'sosovalue (cached)', NOW, 'stale');
    const comp = scoreEtf(flows);
    expect(comp.available).toBe(true);
    expect(comp.risks.join(' ')).toContain('stale');
  });
});
