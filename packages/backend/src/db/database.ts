import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Candle1m, Horizon, HorizonSignal, SignalLabel, StoredEvaluation, DivergenceEvent } from '../types.js';
import type { CmcNewsItem } from '../providers/cmcNews.js';
import { classifyRegime as regimeFromTechnical } from '../scoring/edge.js';

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

    // v3 — self-collected daily ETF flow history (additive; touches no existing tables)
    if (this.userVersion < 3) {
      this.db.exec(`
        CREATE TABLE etf_flow_history (
          date TEXT PRIMARY KEY,
          net_flow REAL NOT NULL,
          source TEXT NOT NULL,
          fetched_at INTEGER NOT NULL
        );
        PRAGMA user_version = 3;
      `);
    }

    // v4 — observational CMC News feed. It is deliberately separate from signals/scoring.
    if (this.userVersion < 4) {
      this.db.exec(`
        CREATE TABLE news_items (
          post_id TEXT PRIMARY KEY,
          published_ts INTEGER NOT NULL,
          fetched_at INTEGER NOT NULL,
          source TEXT NOT NULL,
          url TEXT NOT NULL,
          text TEXT NOT NULL,
          category TEXT NOT NULL,
          relevance REAL NOT NULL,
          sentiment_score REAL NOT NULL,
          direction TEXT NOT NULL,
          impact TEXT NOT NULL
        );
        CREATE INDEX idx_news_published ON news_items(published_ts DESC);
        PRAGMA user_version = 4;
      `);
    }

    // v5 — evaluation provenance (band + regime) and self-collected 1-minute candles.
    // Existing rows are tagged 'fixed-v1' with the band that actually judged them,
    // and their regime is derived from the technical context stored at signal time.
    if (this.userVersion < 5) {
      this.db.exec(`
        ALTER TABLE evaluations ADD COLUMN band_pct REAL;
        ALTER TABLE evaluations ADD COLUMN band_method TEXT;
        ALTER TABLE evaluations ADD COLUMN regime TEXT;
        UPDATE evaluations SET
          band_method = 'fixed-v1',
          band_pct = CASE horizon WHEN '1h' THEN 0.15 WHEN '4h' THEN 0.35 WHEN '24h' THEN 0.8 ELSE 1.5 END
        WHERE band_method IS NULL;
        CREATE TABLE btc_candles_1m (
          ts INTEGER PRIMARY KEY,
          open REAL NOT NULL,
          high REAL NOT NULL,
          low REAL NOT NULL,
          close REAL NOT NULL,
          volume REAL NOT NULL,
          taker_buy_volume REAL NOT NULL
        );
      `);
      this.backfillRegimes();
      this.db.exec('PRAGMA user_version = 5');
    }
  }

  /** Derive regime for legacy evaluation rows from the signal's stored technical context. */
  private backfillRegimes(): void {
    const rows = this.db
      .prepare('SELECT e.id AS id, s.context_json AS ctx FROM evaluations e JOIN signals s ON s.id = e.signal_id WHERE e.regime IS NULL')
      .all() as unknown as Array<{ id: number; ctx: string | null }>;
    const update = this.db.prepare('UPDATE evaluations SET regime = ? WHERE id = ?');
    this.db.exec('BEGIN');
    try {
      for (const r of rows) {
        let regime = 'unknown';
        if (r.ctx) {
          try {
            const ctx = JSON.parse(r.ctx) as { technicalValues?: Record<string, unknown> };
            regime = regimeFromTechnical(ctx.technicalValues);
          } catch {
            // unparseable legacy context — stays unknown
          }
        }
        update.run(regime, r.id);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------- 1-minute candles ----------

  upsertCandle(c: Candle1m): void {
    this.db
      .prepare(
        `INSERT INTO btc_candles_1m (ts, open, high, low, close, volume, taker_buy_volume) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ts) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume, taker_buy_volume = excluded.taker_buy_volume`,
      )
      .run(c.ts, c.open, c.high, c.low, c.close, c.volume, c.takerBuyVolume);
  }

  upsertCandles(candles: Candle1m[]): void {
    this.db.exec('BEGIN');
    try {
      for (const c of candles) this.upsertCandle(c);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Newest N candles in chronological order. */
  getRecentCandles(n: number): Candle1m[] {
    const rows = this.db
      .prepare('SELECT ts, open, high, low, close, volume, taker_buy_volume AS takerBuyVolume FROM btc_candles_1m ORDER BY ts DESC LIMIT ?')
      .all(n) as unknown as Candle1m[];
    return rows.reverse();
  }

  /** Chronological price samples since a timestamp (for realized volatility). */
  getPriceSeriesSince(sinceTs: number): number[] {
    const rows = this.db
      .prepare('SELECT price FROM btc_price_history WHERE ts >= ? ORDER BY ts ASC')
      .all(sinceTs) as unknown as Array<{ price: number }>;
    return rows.map((r) => r.price);
  }

  /** Lightweight evaluation rows for edge/conformal/drift math (no JSON columns). */
  getEvaluationRowsLite(): Array<{ horizon: Horizon; signal_ts: number; final_score: number; pct_change: number; actual_direction: 'up' | 'down' | 'flat'; correct: number; regime: string | null; band_method: string | null }> {
    return this.db
      .prepare('SELECT horizon, signal_ts, final_score, pct_change, actual_direction, correct, regime, band_method FROM evaluations ORDER BY signal_ts ASC')
      .all() as unknown as Array<{ horizon: Horizon; signal_ts: number; final_score: number; pct_change: number; actual_direction: 'up' | 'down' | 'flat'; correct: number; regime: string | null; band_method: string | null }>;
  }

  // ---------- CMC news (observational only; not part of model scoring) ----------

  upsertNewsItems(rows: CmcNewsItem[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO news_items
       (post_id, published_ts, fetched_at, source, url, text, category, relevance, sentiment_score, direction, impact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(post_id) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         text = excluded.text,
         category = excluded.category,
         relevance = excluded.relevance,
         sentiment_score = excluded.sentiment_score,
         direction = excluded.direction,
         impact = excluded.impact`,
    );
    this.db.exec('BEGIN');
    try {
      for (const row of rows) {
        stmt.run(
          row.id, row.publishedTs, row.fetchedAt, 'CMC News (@CMC_News)', row.url, row.text,
          row.category, row.relevance, row.sentimentScore, row.direction, row.impact,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  getRecentNewsItems(limit: number): CmcNewsItem[] {
    const rows = this.db
      .prepare('SELECT * FROM news_items ORDER BY published_ts DESC LIMIT ?')
      .all(limit) as unknown as NewsItemRow[];
    return rows.map((row) => ({
      id: row.post_id,
      text: row.text,
      publishedTs: row.published_ts,
      fetchedAt: row.fetched_at,
      url: row.url,
      category: row.category as CmcNewsItem['category'],
      relevance: row.relevance,
      sentimentScore: row.sentiment_score,
      direction: row.direction as CmcNewsItem['direction'],
      impact: row.impact as CmcNewsItem['impact'],
    }));
  }

  exportNewsRows(): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT post_id, published_ts, fetched_at, source, url, category, relevance, sentiment_score, direction, impact, text FROM news_items ORDER BY published_ts ASC')
      .all() as unknown as Array<Record<string, unknown>>;
  }

  // ---------- etf flows ----------

  upsertEtfFlows(rows: Array<{ date: string; netFlow: number; source: string }>, fetchedAt: number): void {
    const stmt = this.db.prepare(
      'INSERT INTO etf_flow_history (date, net_flow, source, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET net_flow = excluded.net_flow, source = excluded.source, fetched_at = excluded.fetched_at',
    );
    this.db.exec('BEGIN');
    try {
      for (const r of rows) stmt.run(r.date, r.netFlow, r.source, fetchedAt);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Newest-first daily ETF flow rows. */
  getRecentEtfFlows(limit: number): Array<{ date: string; net_flow: number; source: string; fetched_at: number }> {
    return this.db
      .prepare('SELECT date, net_flow, source, fetched_at FROM etf_flow_history ORDER BY date DESC LIMIT ?')
      .all(limit) as unknown as Array<{ date: string; net_flow: number; source: string; fetched_at: number }>;
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
          predicted_label, raw_label, actual_direction, correct, raw_correct, confidence, final_score, session, components_json,
          band_pct, band_method, regime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.signal_id, e.horizon, e.signal_ts, e.evaluated_ts, e.entry_price, e.future_price,
        e.abs_change, e.pct_change, e.predicted_label, e.raw_label, e.actual_direction,
        e.correct, e.raw_correct, e.confidence, e.final_score, e.session, e.components_json,
        e.band_pct, e.band_method, e.regime,
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
      .prepare('SELECT id, signal_id, horizon, signal_ts, evaluated_ts, entry_price, future_price, abs_change, pct_change, predicted_label, raw_label, actual_direction, correct, raw_correct, confidence, final_score, session, band_pct, band_method, regime FROM evaluations ORDER BY signal_ts ASC')
      .all() as unknown as Array<Record<string, unknown>>;
  }

  exportSnapshotRows(): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT market_id, title, probability, volume, liquidity, ts FROM polymarket_history ORDER BY ts ASC')
      .all() as unknown as Array<Record<string, unknown>>;
  }

  // ---------- maintenance ----------

  /** Row counts for every production table — used by /health and import verification. */
  countsByTable(): Record<string, number> {
    const tables = ['signals', 'evaluations', 'divergences', 'polymarket_history', 'btc_price_history', 'btc_candles_1m', 'alerts', 'news_items'];
    const out: Record<string, number> = {};
    for (const t of tables) {
      out[t] = (this.db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
    }
    return out;
  }

  /** Consistent point-in-time snapshot of the whole DB (works under WAL). */
  backupTo(destPath: string): void {
    this.db.prepare('VACUUM INTO ?').run(destPath);
  }

  pruneOldData(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;
    this.db.prepare('DELETE FROM polymarket_history WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM btc_price_history WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM btc_candles_1m WHERE ts < ?').run(cutoff);
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

interface NewsItemRow {
  post_id: string;
  published_ts: number;
  fetched_at: number;
  source: string;
  url: string;
  text: string;
  category: string;
  relevance: number;
  sentiment_score: number;
  direction: string;
  impact: string;
}
