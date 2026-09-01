import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Horizon, HorizonSignal, SignalLabel, StoredEvaluation, DivergenceEvent } from '../types.js';

/**
 * Versioned schema via PRAGMA user_version.
 * v1 — Phase 1 baseline (signals, polymarket_history, btc_price_history, alerts)
 * v2 — Phase 2: signals.raw_label + signals.context_json, evaluations, divergences
 * All data lives in one SQLite file; restarts must never lose rows.
 */
export class SignalDatabase {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
  }

  private get userVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as unknown as { user_version: number };
    return row.user_version;
  }

  private migrate(): void {
    if (this.userVersion < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS polymarket_history (
          market_id TEXT NOT NULL,
          title TEXT NOT NULL,
          probability REAL NOT NULL,
          volume REAL,
          liquidity REAL,
          ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pm_hist ON polymarket_history(market_id, ts);

        CREATE TABLE IF NOT EXISTS btc_price_history (
          ts INTEGER NOT NULL,
          price REAL NOT NULL,
          volume REAL
        );
        CREATE INDEX IF NOT EXISTS idx_btc_ts ON btc_price_history(ts);

        CREATE TABLE IF NOT EXISTS signals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          horizon TEXT NOT NULL,
          btc_price REAL,
          polymarket_score REAL NOT NULL,
          technical_score REAL NOT NULL,
          etf_score REAL NOT NULL,
          macro_score REAL NOT NULL,
          liquidity_score REAL NOT NULL,
          final_score REAL NOT NULL,
          label TEXT NOT NULL,
          confidence REAL NOT NULL,
          reasons_json TEXT NOT NULL,
          risks_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(horizon, ts);

        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          severity TEXT NOT NULL,
          horizon TEXT,
          ts INTEGER NOT NULL,
          acknowledged INTEGER NOT NULL DEFAULT 0
        );
        PRAGMA user_version = 1;
      `);
    }

    if (this.userVersion < 2) {
      this.db.exec(`
        ALTER TABLE signals ADD COLUMN raw_label TEXT;
        ALTER TABLE signals ADD COLUMN context_json TEXT;
        UPDATE signals SET raw_label = label WHERE raw_label IS NULL;

        CREATE TABLE evaluations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          signal_id INTEGER NOT NULL UNIQUE REFERENCES signals(id),
          horizon TEXT NOT NULL,
          signal_ts INTEGER NOT NULL,
          evaluated_ts INTEGER NOT NULL,
          entry_price REAL NOT NULL,
          future_price REAL NOT NULL,
          abs_change REAL NOT NULL,
          pct_change REAL NOT NULL,
          predicted_label TEXT NOT NULL,
          raw_label TEXT NOT NULL,
          actual_direction TEXT NOT NULL,
          correct INTEGER NOT NULL,
          raw_correct INTEGER NOT NULL,
          confidence REAL NOT NULL,
          final_score REAL NOT NULL,
          session TEXT NOT NULL,
          components_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_eval_horizon ON evaluations(horizon, signal_ts);

        CREATE TABLE divergences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          kind TEXT NOT NULL,
          btc_change_pct REAL NOT NULL,
          poly_shift_score REAL NOT NULL,
          window_hours REAL NOT NULL,
          message TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_div_ts ON divergences(ts);
        PRAGMA user_version = 2;
      `);
    }
  }

  // ---------- polymarket snapshots ----------

  insertPolymarketSnapshot(rows: Array<{ marketId: string; title: string; probability: number; volume: number; liquidity: number; ts: number }>): void {
    const stmt = this.db.prepare(
      'INSERT INTO polymarket_history (market_id, title, probability, volume, liquidity, ts) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.db.exec('BEGIN');
    try {
      for (const r of rows) stmt.run(r.marketId, r.title, r.probability, r.volume, r.liquidity, r.ts);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  getProbabilityAt(marketId: string, targetTs: number, toleranceMs: number): number | null {
    const row = this.db
      .prepare(
        `SELECT probability FROM polymarket_history
         WHERE market_id = ? AND ts BETWEEN ? AND ?
         ORDER BY ABS(ts - ?) ASC LIMIT 1`,
      )
      .get(marketId, targetTs - toleranceMs, targetTs + toleranceMs, targetTs) as { probability: number } | undefined;
    return row?.probability ?? null;
  }

  /** Chronological probability path for one market since a timestamp (for momentum/persistence). */
  getProbabilitySeries(marketId: string, sinceTs: number): Array<{ ts: number; probability: number }> {
    return this.db
      .prepare('SELECT ts, probability FROM polymarket_history WHERE market_id = ? AND ts >= ? ORDER BY ts ASC')
      .all(marketId, sinceTs) as unknown as Array<{ ts: number; probability: number }>;
  }

  /** Oldest snapshot timestamp — how far back our self-collected history goes. */
  getEarliestSnapshotTs(): number | null {
    const row = this.db.prepare('SELECT MIN(ts) AS min_ts FROM polymarket_history').get() as
      | { min_ts: number | null }
      | undefined;
    return row?.min_ts ?? null;
  }

  // ---------- btc price ----------

  insertBtcPrice(ts: number, price: number, volume: number | null): void {
    this.db.prepare('INSERT INTO btc_price_history (ts, price, volume) VALUES (?, ?, ?)').run(ts, price, volume);
  }

  getBtcPriceAt(targetTs: number, toleranceMs: number): number | null {
    const row = this.db
      .prepare(
        `SELECT price FROM btc_price_history WHERE ts BETWEEN ? AND ?
         ORDER BY ABS(ts - ?) ASC LIMIT 1`,
      )
      .get(targetTs - toleranceMs, targetTs + toleranceMs, targetTs) as { price: number } | undefined;
    return row?.price ?? null;
  }

  // ---------- signals ----------

  insertSignal(signal: HorizonSignal): number {
    const result = this.db
      .prepare(
        `INSERT INTO signals (ts, horizon, btc_price, polymarket_score, technical_score, etf_score, macro_score, liquidity_score, final_score, label, raw_label, confidence, reasons_json, risks_json, context_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        signal.timestamp,
        signal.horizon,
        signal.btcPrice,
        signal.components.polymarket.score,
        signal.components.technical.score,
        signal.components.etf.score,
        signal.components.macro.score,
        signal.components.liquidity.score,
        signal.finalScore,
        signal.label,
        signal.rawLabel,
        signal.confidence,
        JSON.stringify(signal.reasons),
        JSON.stringify(signal.risks),
        JSON.stringify(signal.context),
      );
    return Number(result.lastInsertRowid);
  }

  getSignalHistory(horizon: Horizon, limit: number): SignalRow[] {
    return this.db
      .prepare('SELECT * FROM signals WHERE horizon = ? ORDER BY ts DESC LIMIT ?')
      .all(horizon, limit) as unknown as SignalRow[];
  }

  /** Last persisted stabilized label per horizon — bootstraps hysteresis after restart. */
  getLatestLabels(): Partial<Record<Horizon, SignalLabel>> {
    const rows = this.db
      .prepare(
        `SELECT horizon, label FROM signals s
         WHERE ts = (SELECT MAX(ts) FROM signals WHERE horizon = s.horizon)`,
      )
      .all() as unknown as Array<{ horizon: Horizon; label: SignalLabel }>;
    const out: Partial<Record<Horizon, SignalLabel>> = {};
    for (const r of rows) out[r.horizon] = r.label;
    return out;
  }

  getMaxSignalTs(): number {
    const row = this.db.prepare('SELECT MAX(ts) AS max_ts FROM signals').get() as { max_ts: number | null } | undefined;
    return row?.max_ts ?? 0;
  }

  // ---------- evaluations ----------

  /** Signals whose horizon has elapsed and which have no evaluation row yet. */
  getSignalsDueForEvaluation(horizon: Horizon, dueBeforeTs: number, limit = 200): SignalRow[] {
    return this.db
      .prepare(
        `SELECT s.* FROM signals s
         LEFT JOIN evaluations e ON e.signal_id = s.id
         WHERE s.horizon = ? AND s.ts <= ? AND e.id IS NULL AND s.btc_price IS NOT NULL
         ORDER BY s.ts ASC LIMIT ?`,
      )
      .all(horizon, dueBeforeTs, limit) as unknown as SignalRow[];
  }

  insertEvaluation(e: Omit<StoredEvaluation, 'id'> & { components_json: string }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO evaluations
         (signal_id, horizon, signal_ts, evaluated_ts, entry_price, future_price, abs_change, pct_change,
          predicted_label, raw_label, actual_direction, correct, raw_correct, confidence, final_score, session, components_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.signal_id, e.horizon, e.signal_ts, e.evaluated_ts, e.entry_price, e.future_price,
        e.abs_change, e.pct_change, e.predicted_label, e.raw_label, e.actual_direction,
        e.correct, e.raw_correct, e.confidence, e.final_score, e.session, e.components_json,
      );
  }

  getEvaluations(horizon?: Horizon): EvaluationRow[] {
    if (horizon) {
      return this.db
        .prepare('SELECT * FROM evaluations WHERE horizon = ? ORDER BY signal_ts ASC')
        .all(horizon) as unknown as EvaluationRow[];
    }
    return this.db.prepare('SELECT * FROM evaluations ORDER BY signal_ts ASC').all() as unknown as EvaluationRow[];
  }

  countEvaluations(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM evaluations').get() as { c: number };
    return row.c;
  }

  // ---------- divergences ----------

  insertDivergence(d: Omit<DivergenceEvent, 'id'>): void {
    this.db
      .prepare('INSERT INTO divergences (ts, kind, btc_change_pct, poly_shift_score, window_hours, message) VALUES (?, ?, ?, ?, ?, ?)')
      .run(d.ts, d.kind, d.btc_change_pct, d.poly_shift_score, d.window_hours, d.message);
  }

  getRecentDivergences(limit: number): DivergenceEvent[] {
    return this.db
      .prepare('SELECT * FROM divergences ORDER BY ts DESC LIMIT ?')
      .all(limit) as unknown as DivergenceEvent[];
  }

  hasRecentDivergence(kind: string, sinceTs: number): boolean {
    return (
      this.db.prepare('SELECT 1 FROM divergences WHERE kind = ? AND ts >= ? LIMIT 1').get(kind, sinceTs) !== undefined
    );
  }

  // ---------- alerts ----------

  insertAlert(type: string, message: string, severity: string, horizon: Horizon | null, ts: number): void {
    this.db
      .prepare('INSERT INTO alerts (type, message, severity, horizon, ts) VALUES (?, ?, ?, ?, ?)')
      .run(type, message, severity, horizon, ts);
  }

  getRecentAlerts(limit: number): AlertRow[] {
    return this.db.prepare('SELECT * FROM alerts ORDER BY ts DESC LIMIT ?').all(limit) as unknown as AlertRow[];
  }

  acknowledgeAlert(id: number): void {
    this.db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(id);
  }

  hasRecentAlert(type: string, message: string, sinceTs: number): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM alerts WHERE type = ? AND message = ? AND ts >= ? LIMIT 1')
      .get(type, message, sinceTs);
    return row !== undefined;
  }

  // ---------- exports ----------

  exportSignalRows(): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT id, ts, horizon, btc_price, polymarket_score, technical_score, etf_score, macro_score, liquidity_score, final_score, label, raw_label, confidence FROM signals ORDER BY ts ASC')
      .all() as unknown as Array<Record<string, unknown>>;
  }

  exportEvaluationRows(): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT id, signal_id, horizon, signal_ts, evaluated_ts, entry_price, future_price, abs_change, pct_change, predicted_label, raw_label, actual_direction, correct, raw_correct, confidence, final_score, session FROM evaluations ORDER BY signal_ts ASC')
      .all() as unknown as Array<Record<string, unknown>>;
  }

  exportSnapshotRows(): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT market_id, title, probability, volume, liquidity, ts FROM polymarket_history ORDER BY ts ASC')
      .all() as unknown as Array<Record<string, unknown>>;
  }

  // ---------- maintenance ----------

  pruneOldData(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;
    this.db.prepare('DELETE FROM polymarket_history WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM btc_price_history WHERE ts < ?').run(cutoff);
  }

  close(): void {
    this.db.close();
  }
}

export interface SignalRow {
  id: number;
  ts: number;
  horizon: Horizon;
  btc_price: number | null;
  polymarket_score: number;
  technical_score: number;
  etf_score: number;
  macro_score: number;
  liquidity_score: number;
  final_score: number;
  label: SignalLabel;
  raw_label: SignalLabel | null;
  confidence: number;
  reasons_json: string;
  risks_json: string;
  context_json: string | null;
}

export interface EvaluationRow extends StoredEvaluation {
  components_json: string;
}

export interface AlertRow {
  id: number;
  type: string;
  message: string;
  severity: string;
  horizon: Horizon | null;
  ts: number;
  acknowledged: number;
}
