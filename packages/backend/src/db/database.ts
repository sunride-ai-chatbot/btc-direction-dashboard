import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Candle1m, Horizon, HorizonSignal, SignalLabel, StoredEvaluation, DivergenceEvent } from '../types.js';
import type { CmcNewsItem } from '../providers/cmcNews.js';
import type { VenueReading } from '../providers/derivatives.js';
import { classifyRegime as regimeFromTechnical } from '../scoring/edge.js';

/**
 * Versioned schema via PRAGMA user_version.
 * v1 — Phase 1 baseline (signals, polymarket_history, btc_price_history, alerts)
 * v2 — Phase 2: signals.raw_label + signals.context_json, evaluations, divergences
 * v3 — etf_flow_history · v4 — news_items · v5 — evaluation provenance + btc_candles_1m
 * v6 — nullable candle taker split (exchange-agnostic order flow) + derivatives_history
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
    // The whole step — DDL, backfill, and the version bump — is ONE transaction: if the
    // process dies mid-migration (e.g. a Railway SIGTERM), the next boot retries cleanly
    // instead of throwing "duplicate column name" against a half-applied schema.
    if (this.userVersion < 5) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(`
          ALTER TABLE evaluations ADD COLUMN band_pct REAL;
          ALTER TABLE evaluations ADD COLUMN band_method TEXT;
          ALTER TABLE evaluations ADD COLUMN regime TEXT;
          UPDATE evaluations SET
            band_method = 'fixed-v1',
            band_pct = CASE horizon WHEN '1h' THEN 0.15 WHEN '4h' THEN 0.35 WHEN '24h' THEN 0.8 ELSE 1.5 END
          WHERE band_method IS NULL;
          CREATE TABLE IF NOT EXISTS btc_candles_1m (
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
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }

    // v6 — order flow no longer depends on Binance's kline stream: candles now come from
    // pooled live trades (any venue) or a REST backfill that may not know the taker split,
    // so taker_buy_volume becomes nullable (SQLite cannot relax NOT NULL in place — the
    // table is rebuilt and the rows copied). Also adds the tracking-only derivatives
    // history (funding / open interest per venue). Same single-transaction rule as v5.
    if (this.userVersion < 6) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(`
          CREATE TABLE btc_candles_1m_v6 (
            ts INTEGER PRIMARY KEY,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL NOT NULL,
            taker_buy_volume REAL
          );
          INSERT INTO btc_candles_1m_v6 (ts, open, high, low, close, volume, taker_buy_volume)
            SELECT ts, open, high, low, close, volume, taker_buy_volume FROM btc_candles_1m;
          DROP TABLE btc_candles_1m;
          ALTER TABLE btc_candles_1m_v6 RENAME TO btc_candles_1m;
          CREATE TABLE derivatives_history (
            ts INTEGER NOT NULL,
            venue TEXT NOT NULL,
            funding_8h_pct REAL,
            predicted_funding_8h_pct REAL,
            oi_btc REAL,
            oi_usd REAL,
            mark_price REAL,
            PRIMARY KEY (ts, venue)
          );
          CREATE INDEX idx_deriv_venue_ts ON derivatives_history(venue, ts);
        `);
        this.db.exec('PRAGMA user_version = 6');
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  /**
   * Derive regime for legacy evaluation rows from the signal's stored technical context.
   * Runs inside the caller's transaction (v5 migration) — no BEGIN/COMMIT of its own,
   * since SQLite does not support nested transactions.
   */
  private backfillRegimes(): void {
    const rows = this.db
      .prepare('SELECT e.id AS id, s.context_json AS ctx FROM evaluations e JOIN signals s ON s.id = e.signal_id WHERE e.regime IS NULL')
      .all() as unknown as Array<{ id: number; ctx: string | null }>;
    const update = this.db.prepare('UPDATE evaluations SET regime = ? WHERE id = ?');
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
  }

  // ---------- 1-minute candles ----------

  /**
   * Same merge rule as PriceStream.seedCandles: a stored candle that knows its taker split
   * is never overwritten by one that doesn't (a REST backfill fills gaps, it must not
   * erase order flow the live trade streams already captured).
   */
  upsertCandle(c: Candle1m): void {
    this.db
      .prepare(
        `INSERT INTO btc_candles_1m (ts, open, high, low, close, volume, taker_buy_volume) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ts) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume, taker_buy_volume = excluded.taker_buy_volume
         WHERE excluded.taker_buy_volume IS NOT NULL OR btc_candles_1m.taker_buy_volume IS NULL`,
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

  /** Oldest stored candle timestamp — how much chart context already exists. */
  getOldestCandleTs(): number | null {
    const row = this.db.prepare('SELECT MIN(ts) AS min_ts FROM btc_candles_1m').get() as { min_ts: number | null } | undefined;
    return row?.min_ts ?? null;
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

  // ---------- derivatives (tracking only; not part of model scoring) ----------

  upsertDerivatives(rows: VenueReading[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO derivatives_history (ts, venue, funding_8h_pct, predicted_funding_8h_pct, oi_btc, oi_usd, mark_price)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ts, venue) DO UPDATE SET
         funding_8h_pct = excluded.funding_8h_pct,
         predicted_funding_8h_pct = excluded.predicted_funding_8h_pct,
         oi_btc = excluded.oi_btc,
         oi_usd = excluded.oi_usd,
         mark_price = excluded.mark_price`,
    );
    this.db.exec('BEGIN');
    try {
      for (const r of rows) stmt.run(r.ts, r.venue, r.fundingRate8hPct, r.predictedFundingRate8hPct, r.openInterestBtc, r.openInterestUsd, r.markPrice);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Chronological per-venue readings since a timestamp. */
  getDerivativesSince(sinceTs: number): VenueReading[] {
    const rows = this.db
      .prepare('SELECT * FROM derivatives_history WHERE ts >= ? ORDER BY ts ASC, venue ASC')
      .all(sinceTs) as unknown as DerivativesRow[];
    return rows.map(derivativesRowToReading);
  }

  /** The newest stored reading of every venue (the stale fallback when no venue answers). */
  getLatestDerivativesByVenue(): VenueReading[] {
    const rows = this.db
      .prepare(
        `SELECT d.* FROM derivatives_history d
         WHERE d.ts = (SELECT MAX(ts) FROM derivatives_history WHERE venue = d.venue)
         ORDER BY d.venue ASC`,
      )
      .all() as unknown as DerivativesRow[];
    return rows.map(derivativesRowToReading);
  }

  exportDerivativesRows(): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT ts, venue, funding_8h_pct, predicted_funding_8h_pct, oi_btc, oi_usd, mark_price FROM derivatives_history ORDER BY ts ASC, venue ASC')
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
    const tables = ['signals', 'evaluations', 'divergences', 'polymarket_history', 'btc_price_history', 'btc_candles_1m', 'alerts', 'news_items', 'derivatives_history'];
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
    this.db.prepare('DELETE FROM derivatives_history WHERE ts < ?').run(cutoff);
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

interface DerivativesRow {
  ts: number;
  venue: string;
  funding_8h_pct: number | null;
  predicted_funding_8h_pct: number | null;
  oi_btc: number | null;
  oi_usd: number | null;
  mark_price: number | null;
}

function derivativesRowToReading(row: DerivativesRow): VenueReading {
  return {
    venue: row.venue as VenueReading['venue'],
    ts: row.ts,
    fundingRate8hPct: row.funding_8h_pct,
    predictedFundingRate8hPct: row.predicted_funding_8h_pct,
    openInterestBtc: row.oi_btc,
    openInterestUsd: row.oi_usd,
    markPrice: row.mark_price,
  };
}
