import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SignalDatabase } from '../src/db/database.js';
import { PARSER_FIX_TS, SCORING_VERSION, MIN_POOLABLE_VERSION } from '../src/scoring/version.js';
import { buildScoringEpochReport } from '../src/scoring/reports.js';
import type { HorizonSignal } from '../src/types.js';

function signal(ts: number, score = 30): HorizonSignal {
  const comp = { score: 10, weight: 0.2, available: true, freshness: 'fresh' as const, details: {}, reasons: [], risks: [] };
  return {
    horizon: '1h', label: 'BULLISH', rawLabel: 'BULLISH', finalScore: score, confidence: 60,
    reasons: [], risks: [], components: { polymarket: comp, technical: comp, etf: comp, macro: comp, liquidity: comp },
    btcPrice: 100_000, timestamp: ts, limitedHistory: false, historyNote: null,
    context: {
      appliedWeights: {}, configuredWeights: {}, providerFreshness: {}, unavailableProviders: [],
      session: 'US', polymarketMarketsUsed: [], polymarketCategoryScores: {},
      technicalValues: {}, macroValues: {}, etfValues: {},
    },
    edge: null, gated: false, conformal: null, similarStates: null, regime: 'unknown',
  };
}

function evaluation(signalId: number, ts: number) {
  return {
    signal_id: signalId, horizon: '1h' as const, signal_ts: ts, evaluated_ts: ts + 3_600_000,
    entry_price: 100_000, future_price: 100_500, abs_change: 500, pct_change: 0.5,
    predicted_label: 'BULLISH' as const, raw_label: 'BULLISH' as const, actual_direction: 'up' as const,
    correct: 1, raw_correct: 1, confidence: 60, final_score: 30, session: 'US',
    components_json: '{}', band_pct: 0.15, band_method: 'fixed-v1', regime: 'range',
  };
}

describe('scoring epochs', () => {
  it('stamps new rows with the current version and inherits it onto their evaluations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btc-epoch-'));
    try {
      const db = new SignalDatabase(join(dir, 'e.sqlite'));
      const id = db.insertSignal(signal(PARSER_FIX_TS + 10_000));
      db.insertEvaluation(evaluation(id, PARSER_FIX_TS + 10_000));
      const rows = db.getEvaluations('1h');
      expect(rows).toHaveLength(1);
      expect(rows[0].scoring_version).toBe(SCORING_VERSION);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REGRESSION: pre-parser-fix rows are never pooled into the figures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btc-epoch-pool-'));
    try {
      const path = join(dir, 'e.sqlite');
      const db = new SignalDatabase(path);
      // Write rows on both sides of the boundary, then force them to the versions a
      // migrated legacy database would carry.
      const oldId = db.insertSignal(signal(PARSER_FIX_TS - 60_000));
      const newId = db.insertSignal(signal(PARSER_FIX_TS + 60_000));
      db.insertEvaluation(evaluation(oldId, PARSER_FIX_TS - 60_000));
      db.insertEvaluation(evaluation(newId, PARSER_FIX_TS + 60_000));
      db.close();

      const raw = new DatabaseSync(path);
      raw.exec(`UPDATE signals SET scoring_version = CASE WHEN ts < ${PARSER_FIX_TS} THEN 1 ELSE 2 END`);
      raw.exec(`UPDATE evaluations SET scoring_version = CASE WHEN signal_ts < ${PARSER_FIX_TS} THEN 1 ELSE 2 END`);
      raw.close();

      const reopened = new SignalDatabase(path);
      expect(reopened.countEvaluations()).toBe(2);          // nothing deleted
      expect(reopened.getEvaluations('1h')).toHaveLength(1); // only the comparable one is pooled
      expect(reopened.getEvaluationRowsLite()).toHaveLength(1); // and the edge gate agrees
      expect(reopened.getEvaluations('1h', { allEpochs: true })).toHaveLength(2);

      const report = buildScoringEpochReport(reopened);
      expect(report.pooledEvaluations).toBe(1);
      expect(report.excludedEvaluations).toBe(1);
      expect(report.epochs.find((e) => e.version === 1)?.pooled).toBe(false);
      expect(report.epochs.find((e) => e.version === 1)?.summary).toContain('parser');
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a v6 database by attributing every existing row to an epoch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btc-epoch-mig-'));
    try {
      const path = join(dir, 'e.sqlite');
      const db = new SignalDatabase(path);
      const before = PARSER_FIX_TS - 3_600_000;
      const after = PARSER_FIX_TS + 3_600_000;
      const a = db.insertSignal(signal(before));
      const b = db.insertSignal(signal(after));
      db.insertEvaluation(evaluation(a, before));
      db.insertEvaluation(evaluation(b, after));
      db.close();

      // Rewind to a genuine v6 database: the column does not exist at all, and
      // user_version says 6 — exactly what the production volume holds today.
      const raw = new DatabaseSync(path);
      raw.exec('DROP INDEX IF EXISTS idx_eval_version');
      raw.exec('ALTER TABLE signals DROP COLUMN scoring_version');
      raw.exec('ALTER TABLE evaluations DROP COLUMN scoring_version');
      raw.exec('PRAGMA user_version = 6');
      raw.close();

      const migrated = new SignalDatabase(path);
      const all = migrated.getEvaluations('1h', { allEpochs: true });
      expect(all).toHaveLength(2);
      expect(all.find((r) => r.signal_ts === before)?.scoring_version).toBe(1);
      expect(all.find((r) => r.signal_ts === after)?.scoring_version).toBe(2);
      expect(all.every((r) => r.scoring_version !== null)).toBe(true);
      expect(MIN_POOLABLE_VERSION).toBe(2);
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
