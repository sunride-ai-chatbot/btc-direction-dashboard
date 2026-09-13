import { describe, expect, it } from 'vitest';
import { buildHourlyShadow } from '../src/scoring/shadow.js';
import type { ComponentScore } from '../src/types.js';

const component = (details: Record<string, unknown>): ComponentScore => ({ score: 0, weight: 0, available: true, freshness: 'fresh', details, reasons: [], risks: [] });

describe('1h microstructure shadow model', () => {
  it('leans with aligned short-term flow and momentum', () => {
    const s = buildHourlyShadow(component({ cvd15m: 0.2, cvd1h: 0.1, change1h: 0.5 }), component({ categoryScores: { 'btc-direct': 20 } }), 'trend-up')!;
    expect(s.score).toBeGreaterThan(20);
    expect(s.disagreementPenalty).toBe(1);
  });

  it('dampens a short-lived flow reversal and range regimes', () => {
    const trend = buildHourlyShadow(component({ cvd15m: -0.2, cvd1h: 0.1, change1h: 0.2 }), component({}), 'trend-up')!;
    const range = buildHourlyShadow(component({ cvd15m: -0.2, cvd1h: 0.1, change1h: 0.2 }), component({}), 'range')!;
    expect(trend.disagreementPenalty).toBe(0.65);
    expect(Math.abs(range.score)).toBeLessThan(Math.abs(trend.score));
  });

  it('returns null when no short-horizon evidence exists', () => {
    expect(buildHourlyShadow(component({}), component({}), 'unknown')).toBeNull();
  });
});
