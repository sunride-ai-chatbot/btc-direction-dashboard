import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Horizon, HorizonSignal, SignalLabel } from '../types.js';

export class SignalDatabase {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
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
    `);
  }

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

  insertSignal(signal: HorizonSignal): void {
    this.db
      .prepare(
        `INSERT INTO signals (ts, horizon, btc_price, polymarket_score, technical_score, etf_score, macro_score, liquidity_score, final_score, label, confidence, reasons_json, risks_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        signal.confidence,
        JSON.stringify(signal.reasons),
        JSON.stringify(signal.risks),
      );
  }

  getLatestSignal(horizon: Horizon): SignalRow | null {
    const row = this.db
      .prepare('SELECT * FROM signals WHERE horizon = ? ORDER BY ts DESC LIMIT 1')
      .get(horizon) as SignalRow | undefined;
    return row ?? null;
  }

  getSignalHistory(horizon: Horizon, limit: number): SignalRow[] {
    return this.db
      .prepare('SELECT * FROM signals WHERE horizon = ? ORDER BY ts DESC LIMIT ?')
      .all(horizon, limit) as unknown as SignalRow[];
  }

  getSignalsOlderThan(horizon: Horizon, beforeTs: number): SignalRow[] {
    return this.db
      .prepare('SELECT * FROM signals WHERE horizon = ? AND ts <= ? ORDER BY ts ASC')
      .all(horizon, beforeTs) as unknown as SignalRow[];
  }

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

  /** Deduplication guard: same alert type+message within window */
  hasRecentAlert(type: string, message: string, sinceTs: number): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM alerts WHERE type = ? AND message = ? AND ts >= ? LIMIT 1')
      .get(type, message, sinceTs);
    return row !== undefined;
  }

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
  confidence: number;
  reasons_json: string;
  risks_json: string;
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
