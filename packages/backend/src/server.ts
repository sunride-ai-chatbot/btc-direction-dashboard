import Fastify from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import { writeFileSync, renameSync, rmSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { SignalDatabase } from './db/database.js';
import { GammaPolymarketProvider } from './providers/polymarket.js';
import { ExchangeBitcoinProvider } from './providers/bitcoin.js';
import { ManualFileEtfProvider, SosoValueEtfProvider } from './providers/etf.js';
import { FredMacroProvider } from './providers/macro.js';
import { CmcNewsProvider, type CmcNewsSnapshot } from './providers/cmcNews.js';
import { DerivativesProvider, buildDerivativesSeries, type DerivativesSnapshot } from './providers/derivatives.js';
import { PriceStream, EXCHANGES } from './providers/priceStream.js';
import { fetchCandles, fetchCandleHistory } from './providers/candles.js';
import { runPipeline, type PipelineProviders } from './scoring/pipeline.js';
import { runEvaluationPass } from './scoring/evaluator.js';
import { buildAttributionReport, buildDivergenceReport, buildEvaluationReport, buildReliabilityReport } from './scoring/reports.js';
import { computeAllEdgeStats, driftReport, fitConformal, similarStates, type EvalLike } from './scoring/edge.js';
import { detectDivergence } from './scoring/divergence.js';
import { AlertEngine, DatabaseAlertSink } from './alerts/engine.js';
import { cached } from './utils/cached.js';
import { HealthRegistry } from './utils/health.js';
import { toCsv } from './utils/csv.js';
import {
  DERIVATIVES_CONFIG, DIVERGENCE_CONFIG, EDGE_GATE_CONFIG, EVALUATION_CONFIG, HORIZON_WEIGHTS, NEUTRAL_THRESHOLD_PCT,
  REFRESH_INTERVALS_MS, SERVER_CONFIG, STREAM_CONFIG,
} from './config.js';
import { HORIZONS, type ConformalInterval, type EdgeStats, type Horizon, type SignalBundle, type SignalLabel, type PolymarketSnapshot } from './types.js';

const startedAt = Date.now();
const db = new SignalDatabase(SERVER_CONFIG.dbPath);
const health = new HealthRegistry();

console.log('[startup] node', process.version, '| db:', SERVER_CONFIG.dbPath, '| host:', SERVER_CONFIG.host, '| port:', SERVER_CONFIG.port);
console.log('[startup] row counts:', JSON.stringify(db.countsByTable()));

const polymarketProvider = new GammaPolymarketProvider(db);
const bitcoinProvider = new ExchangeBitcoinProvider();
const etfProvider = process.env.ETF_SOURCE === 'manual' ? new ManualFileEtfProvider() : new SosoValueEtfProvider(db);
const macroProvider = new FredMacroProvider();
const newsProvider = new CmcNewsProvider(db);
const fetchNews = health.instrument('cmc-news', () => newsProvider.fetchNews());
const derivativesProvider = new DerivativesProvider(db);
const fetchDerivatives = health.instrument('derivatives', () => derivativesProvider.fetchSnapshot());

const providers: PipelineProviders = {
  polymarket: { fetchSnapshot: cached(health.instrument('polymarket', () => polymarketProvider.fetchSnapshot()), REFRESH_INTERVALS_MS.polymarket) },
  bitcoin: { fetchTechnicals: cached(health.instrument('btc-price', () => bitcoinProvider.fetchTechnicals()), REFRESH_INTERVALS_MS.btcPrice) },
  etf: { fetchFlows: cached(health.instrument('etf', () => etfProvider.fetchFlows()), REFRESH_INTERVALS_MS.etf) },
  macro: { fetchMacro: cached(health.instrument('macro', () => macroProvider.fetchMacro()), REFRESH_INTERVALS_MS.macro) },
};

const alertEngine = new AlertEngine();
alertEngine.addSink(new DatabaseAlertSink(db));

// ---------- live price stream (WebSocket in, SSE out) ----------

const stream = new PriceStream(
  (candle) => {
    try {
      db.upsertCandle(candle);
    } catch (err) {
      console.error('[stream] candle persist failed:', err instanceof Error ? err.message : err);
    }
  },
  600,
  // A reconnect can leave a gap in the closed-candle series (every venue's trades feed the
  // candles, so a single venue's outage only thins them — but a full outage leaves minutes
  // missing); re-running the REST backfill on any reopen fills price for that gap. The
  // backfill never overwrites a candle that already has its taker split (see preferCandle).
  () => scheduleBackfill(),
);
stream.seedCandles(db.getRecentCandles(600));

let backfillTimer: NodeJS.Timeout | null = null;
function scheduleBackfill(): void {
  // Several venues reopening at once (a network blip) must trigger one backfill, not three.
  if (backfillTimer) return;
  backfillTimer = setTimeout(() => {
    backfillTimer = null;
    void backfillCandles();
  }, 10_000);
}

async function backfillCandles(): Promise<void> {
  try {
    const { candles, source } = await fetchCandles({ interval: '1m', limit: STREAM_CONFIG.candleBackfillLimit });
    stream.seedCandles(candles);
    db.upsertCandles(candles);
    console.log(`[stream] backfilled ${candles.length} 1m candles from ${source}`);
  } catch (err) {
    console.error('[stream] candle backfill failed:', err instanceof Error ? err.message : err);
  }
}

/** One-time deep history so the chart has days of context right after a deploy, not just what accrues afterwards. */
async function backfillCandleHistory(): Promise<void> {
  const target = Date.now() - STREAM_CONFIG.candleHistoryHours * 3_600_000;
  const oldest = db.getOldestCandleTs();
  if (oldest !== null && oldest <= target + 3_600_000) return;
  try {
    const { candles, source } = await fetchCandleHistory(target);
    db.upsertCandles(candles); // split-carrying rows are never overwritten (see upsertCandle)
    console.log(`[stream] deep-backfilled ${candles.length} 1m candles (${(STREAM_CONFIG.candleHistoryHours)}h) from ${source}`);
  } catch (err) {
    console.error('[stream] deep candle backfill failed:', err instanceof Error ? err.message : err);
  }
}

const sseClients = new Set<ServerResponse>();
let ssePending = false;
stream.onUpdate(() => {
  ssePending = true;
});

function reportStreamHealth(): void {
  const st = stream.status();
  const connected = Object.values(st.connected).filter(Boolean).length;
  health.report('btc-stream', {
    freshness: st.freshness,
    latencyMs: st.lastTickTs ? Date.now() - st.lastTickTs : null,
    note: `${connected}/${EXCHANGES.length} exchanges connected · ${st.reconnects} reconnects · CVD from ${stream.recentCandles(240).filter((c) => c.takerBuyVolume !== null).length} candles with taker split`,
    failed: st.freshness === 'unavailable',
  });
}

function streamPayload(): Record<string, unknown> {
  const c = stream.consensus();
  return {
    type: 'tick',
    price: c.price,
    ts: c.ts,
    exchanges: c.exchanges,
    freshExchanges: c.freshExchanges,
    spreadPct: c.spreadPct,
    anomaly: c.anomaly,
    anomalyNote: c.anomalyNote,
    cvd: stream.cvd(),
    streamStatus: stream.status().freshness,
  };
}

function sseBroadcast(event: string, data: unknown): void {
  if (sseClients.size === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ---------- edge / conformal cache (refreshed after every evaluator pass) ----------

interface EdgeCache {
  rows: EvalLike[];
  stats: Record<Horizon, EdgeStats>;
  conformal: Record<Horizon, ((score: number) => ConformalInterval) | null>;
  driftAlarms: Record<Horizon, boolean>;
  updatedAt: number;
}
let edgeCache: EdgeCache | null = null;

function refreshEdgeCache(): void {
  try {
    const now = Date.now();
    const rows = db.getEvaluationRowsLite();
    const stats = computeAllEdgeStats(rows, now);
    const conformal = {} as EdgeCache['conformal'];
    const driftAlarms = {} as EdgeCache['driftAlarms'];
    for (const h of HORIZONS) {
      conformal[h] = fitConformal(rows, h);
      const drift = driftReport(rows, h);
      driftAlarms[h] = drift.alarm;
      const prev = edgeCache?.stats[h]?.status;
      if (prev && prev !== stats[h].status) {
        const msg = `${h} edge status changed ${prev} → ${stats[h].status} (sign agreement ${stats[h].rate === null ? 'n/a' : (stats[h].rate * 100).toFixed(0) + '%'}, n=${stats[h].n})`;
        if (!db.hasRecentAlert('edge-status', msg, now - 6 * 3_600_000)) db.insertAlert('edge-status', msg, 'info', h, now);
      }
      if (drift.alarm) {
        const msg = `${h} model drift alarm — sign agreement has been running below 50% (CUSUM ${drift.cusum})`;
        if (!db.hasRecentAlert('model-drift', msg, now - 6 * 3_600_000)) db.insertAlert('model-drift', msg, 'warning', h, now);
      }
    }
    edgeCache = { rows, stats, conformal, driftAlarms, updatedAt: now };
  } catch (err) {
    console.error('[edge] cache refresh failed:', err instanceof Error ? err.message : err);
  }
}

function enrichFor(horizon: Horizon) {
  const cache = edgeCache;
  if (!cache) return {};
  return {
    edge: cache.stats[horizon],
    conformal: cache.conformal[horizon],
    similar: (score: number) => similarStates(cache.rows, horizon, score, Date.now()),
  };
}

// ---------- state ----------

let latestBundle: SignalBundle | null = null;
let latestPolySnapshot: PolymarketSnapshot | null = null;
let latestNews: CmcNewsSnapshot | null = null;
let latestDerivatives: DerivativesSnapshot | null = null;
// Survive restarts: hysteresis continues from the last persisted labels and the
// persist cadence continues from the last stored signal timestamp.
let stableLabels: Partial<Record<Horizon, SignalLabel>> = db.getLatestLabels();
let lastPersistTs = db.getMaxSignalTs();
let lastBtcUpdateTs: number | null = null;
let lastPolymarketUpdateTs: number | null = null;
let lastEvaluatorRunTs: number | null = null;
let schedulersStarted = false;
let shuttingDown = false;
const timers: NodeJS.Timeout[] = [];
const PERSIST_INTERVAL_MS = 5 * 60_000;

async function computeSignals(): Promise<void> {
  if (shuttingDown) return;
  try {
    const { bundle, polySnapshot, tech } = await runPipeline(providers, stableLabels, {
      consensus: STREAM_CONFIG.enabled ? stream.consensus() : null,
      cvd: STREAM_CONFIG.enabled ? stream.cvd() : null,
      enrichFor,
    });
    latestBundle = bundle;
    latestPolySnapshot = polySnapshot;
    for (const horizon of HORIZONS) stableLabels[horizon] = bundle.signals[horizon].label;
    if (polySnapshot.freshness === 'fresh') lastPolymarketUpdateTs = polySnapshot.timestamp;

    if (tech.freshness === 'fresh' && tech.price > 0) {
      db.insertBtcPrice(bundle.generatedAt, tech.price, tech.volume24h);
      lastBtcUpdateTs = bundle.generatedAt;
    }

    if (bundle.generatedAt - lastPersistTs >= PERSIST_INTERVAL_MS) {
      for (const horizon of HORIZONS) {
        db.insertSignal(bundle.signals[horizon]);
      }
      lastPersistTs = bundle.generatedAt;
    }

    const divergence = detectDivergence(polySnapshot, tech, bundle.generatedAt);
    if (divergence && !db.hasRecentDivergence(divergence.kind, bundle.generatedAt - DIVERGENCE_CONFIG.dedupWindowMs)) {
      db.insertDivergence(divergence);
      db.insertAlert('divergence', divergence.message, 'warning', null, divergence.ts);
      console.log('[divergence]', divergence.message);
    }

    alertEngine.evaluate(bundle, polySnapshot, tech);
    reportStreamHealth();
    sseBroadcast('signal', { generatedAt: bundle.generatedAt, labels: Object.fromEntries(HORIZONS.map((h) => [h, { label: bundle.signals[h].label, gated: bundle.signals[h].gated, confidence: bundle.signals[h].confidence }])) });
  } catch (err) {
    console.error('[pipeline] compute failed:', err instanceof Error ? err.message : err);
  }
}

async function refreshNews(): Promise<void> {
  if (shuttingDown) return;
  try {
    latestNews = await fetchNews();
  } catch (err) {
    console.error('[cmc-news] refresh failed:', err instanceof Error ? err.message : err);
  }
}

async function refreshDerivatives(): Promise<void> {
  if (shuttingDown || !DERIVATIVES_CONFIG.enabled) return;
  try {
    latestDerivatives = await fetchDerivatives();
  } catch (err) {
    console.error('[derivatives] refresh failed:', err instanceof Error ? err.message : err);
  }
}

function evaluateDueSignals(): void {
  if (shuttingDown) return;
  try {
    const { evaluated } = runEvaluationPass(db);
    lastEvaluatorRunTs = Date.now();
    if (evaluated > 0) console.log(`[evaluator] evaluated ${evaluated} signal(s); total ${db.countEvaluations()}`);
    refreshEdgeCache();
  } catch (err) {
    console.error('[evaluator] pass failed:', err instanceof Error ? err.message : err);
  }
}

const app = Fastify({ logger: false, bodyLimit: 128 * 1024 * 1024 });
await app.register(cors, {
  origin: SERVER_CONFIG.corsOrigin ? SERVER_CONFIG.corsOrigin.split(',').map((s) => s.trim()) : true,
});

const CADENCE = { polymarket: 'realtime', 'btc-price': 'realtime', 'btc-stream': 'realtime', macro: 'daily', etf: 'daily', 'cmc-news': 'realtime', derivatives: 'realtime' } as const;

// Railway health check + ops summary. 503 until the scheduler is initialized
// and whenever SQLite stops answering. No secrets in the payload.
app.get('/health', async (_req, reply) => {
  let databaseOk = false;
  let counts: Record<string, number> | null = null;
  try {
    counts = db.countsByTable();
    databaseOk = true;
  } catch {
    databaseOk = false;
  }
  reportStreamHealth();
  const snap = health.snapshot(CADENCE);
  const ok = databaseOk && schedulersStarted && !shuttingDown;
  return reply.code(ok ? 200 : 503).send({
    status: ok ? 'ok' : 'unhealthy',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    database: databaseOk ? 'ok' : 'error',
    databasePath: SERVER_CONFIG.dbPath,
    rowCounts: counts,
    scheduler: schedulersStarted ? (shuttingDown ? 'stopping' : 'running') : 'not-started',
    lastBtcUpdate: lastBtcUpdateTs,
    lastPolymarketUpdate: lastPolymarketUpdateTs,
    lastEvaluatorRun: lastEvaluatorRunTs,
    lastSignalComputedAt: latestBundle?.generatedAt ?? null,
    providers: Object.fromEntries(snap.providers.map((p) => [p.name, p.status])),
    stream: { ...stream.status(), sseClients: sseClients.size, candles: stream.recentCandles(600).length },
    edge: edgeCache ? Object.fromEntries(HORIZONS.map((h) => [h, edgeCache!.stats[h].status])) : null,
  });
});

/** Server-Sent Events: consensus price ticks (throttled) + signal recomputes. */
app.get('/api/stream', (req, reply) => {
  // reply.hijack() bypasses @fastify/cors entirely (it never sees this response), so the
  // allowlist has to be re-applied by hand here — echoing the request Origin unconditionally
  // would let any third-party page open this feed even when CORS_ORIGIN is configured.
  const origin = req.headers.origin as string | undefined;
  const allowed = SERVER_CONFIG.corsOrigin ? SERVER_CONFIG.corsOrigin.split(',').map((s) => s.trim()) : null;
  const acao = allowed ? (origin && allowed.includes(origin) ? origin : allowed[0]) : '*';
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'access-control-allow-origin': acao,
    vary: 'origin',
  });
  reply.hijack();
  reply.raw.write(`event: tick\ndata: ${JSON.stringify(streamPayload())}\n\n`);
  sseClients.add(reply.raw);
  req.raw.on('close', () => {
    sseClients.delete(reply.raw);
  });
});

app.get('/api/signal', async (_req, reply) => {
  if (!latestBundle) return reply.code(503).send({ error: 'Signals not computed yet — try again shortly' });
  return latestBundle;
});

app.get('/api/polymarket', async (_req, reply) => {
  if (!latestPolySnapshot) return reply.code(503).send({ error: 'No Polymarket data yet' });
  return latestPolySnapshot;
});

app.get<{ Querystring: { horizon?: string; limit?: string } }>('/api/history', async (req) => {
  const horizon = (HORIZONS as string[]).includes(req.query.horizon ?? '') ? (req.query.horizon as Horizon) : '24h';
  const limit = Math.min(Number.parseInt(req.query.limit ?? '300', 10) || 300, 2000);
  const rows = db.getSignalHistory(horizon, limit);
  return {
    horizon,
    rows: rows.map((r) => ({
      ...r,
      reasons: JSON.parse(r.reasons_json),
      risks: JSON.parse(r.risks_json),
      reasons_json: undefined,
      risks_json: undefined,
      context_json: undefined,
    })),
  };
});

const reliabilityReport = cached(async () => buildReliabilityReport(db), 60_000);

app.get('/api/evaluation', async () => buildEvaluationReport(db));
app.get('/api/attribution', async () => buildAttributionReport(db));
app.get('/api/divergences', async () => buildDivergenceReport(db));
app.get('/api/reliability', async () => reliabilityReport());
/** Closed 1-minute candles from the DB (up to 72h) — the chart's history; live ticks come over SSE. */
app.get<{ Querystring: { n?: string } }>('/api/candles', async (req) => {
  const n = Math.min(Number.parseInt(req.query.n ?? '120', 10) || 120, 4320);
  return { candles: db.getRecentCandles(n), cvd: stream.cvd(), serverTime: Date.now() };
});

app.get('/api/news', async (_req, reply) => {
  const snapshot = latestNews;
  if (!snapshot) return reply.code(503).send({ error: 'CMC News has not loaded yet' });
  const now = Date.now();
  const reaction = (publishedTs: number, offsetMs: number): number | null => {
    if (publishedTs + offsetMs > now) return null;
    const entry = db.getBtcPriceAt(publishedTs, 12 * 60_000);
    const future = db.getBtcPriceAt(publishedTs + offsetMs, 12 * 60_000);
    return entry && future ? Math.round((((future - entry) / entry) * 100) * 1000) / 1000 : null;
  };
  return {
    ...snapshot,
    modelWeight: 0,
    trackingOnly: true,
    posts: snapshot.posts.map((post) => ({
      ...post,
      btcReaction: {
        m15: reaction(post.publishedTs, 15 * 60_000),
        h1: reaction(post.publishedTs, 60 * 60_000),
        h4: reaction(post.publishedTs, 4 * 60 * 60_000),
        h24: reaction(post.publishedTs, 24 * 60 * 60_000),
      },
    })),
  };
});

/** Derivatives positioning — tracking only (zero model weight), plus the last 24h as a chartable series. */
app.get('/api/derivatives', async (_req, reply) => {
  if (!DERIVATIVES_CONFIG.enabled) return reply.code(404).send({ error: 'Derivatives tracking is disabled (DERIVATIVES=off)' });
  const snapshot = latestDerivatives;
  if (!snapshot) return reply.code(503).send({ error: 'Derivatives data has not loaded yet' });
  const history = buildDerivativesSeries(db.getDerivativesSince(Date.now() - DERIVATIVES_CONFIG.historyLookbackMs));
  return { ...snapshot, modelWeight: 0, trackingOnly: true, history };
});

app.get('/api/health', async () => {
  reportStreamHealth();
  const snap = health.snapshot(CADENCE);
  return {
    ...snap,
    serverTime: Date.now(),
    evaluationsStored: db.countEvaluations(),
    neutralThresholdsPct: NEUTRAL_THRESHOLD_PCT,
    evaluationJobMs: EVALUATION_CONFIG.jobIntervalMs,
    lastEvaluatorRun: lastEvaluatorRunTs,
    edgeGate: { enabled: EDGE_GATE_CONFIG.enabled, minSamples: EDGE_GATE_CONFIG.minSamples, minLowerBound: EDGE_GATE_CONFIG.minLowerBound, windowDays: EDGE_GATE_CONFIG.windowDays },
    stream: { ...stream.status(), sseClients: sseClients.size },
  };
});

app.get('/api/alerts', async () => {
  return { alerts: db.getRecentAlerts(50) };
});

app.post<{ Params: { id: string } }>('/api/alerts/:id/ack', async (req) => {
  db.acknowledgeAlert(Number.parseInt(req.params.id, 10));
  return { ok: true };
});

app.get('/api/status', async () => {
  const bundle = latestBundle;
  return {
    serverTime: Date.now(),
    signalsComputed: bundle !== null,
    lastComputedAt: bundle?.generatedAt ?? null,
    weights: HORIZON_WEIGHTS,
    providers: bundle
      ? Object.fromEntries(
          Object.entries(bundle.signals['24h'].components).map(([name, c]) => [
            name,
            { available: c.available, freshness: c.freshness },
          ]),
        )
      : null,
  };
});

const EXPORTS: Record<string, () => Array<Record<string, unknown>>> = {
  'signals.csv': () => db.exportSignalRows(),
  'evaluations.csv': () => db.exportEvaluationRows(),
  'polymarket_snapshots.csv': () => db.exportSnapshotRows(),
  'news.csv': () => db.exportNewsRows(),
  'derivatives.csv': () => db.exportDerivativesRows(),
};

app.get<{ Params: { file: string } }>('/api/export/:file', async (req, reply) => {
  const exporter = EXPORTS[req.params.file];
  if (!exporter) return reply.code(404).send({ error: 'Unknown export. Available: ' + Object.keys(EXPORTS).join(', ') });
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="${req.params.file}"`);
  return toCsv(exporter());
});

/**
 * ONE-TIME history import (migrating the local production SQLite into the
 * Railway volume). Active only while IMPORT_TOKEN is set; disabled (404)
 * otherwise. The uploaded file is written next to the target and swapped in
 * atomically, then the process exits so the restart policy reopens the
 * imported DB cleanly. Remove IMPORT_TOKEN after use.
 */
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
app.post('/api/admin/import-db', async (req, reply) => {
  const token = SERVER_CONFIG.importToken;
  if (!token) return reply.code(404).send({ error: 'not found' });
  const supplied = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return reply.code(403).send({ error: 'forbidden' });
  }
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length < 4096 || !body.subarray(0, 16).toString('latin1').startsWith('SQLite format 3')) {
    return reply.code(400).send({ error: 'body must be a raw SQLite database file (application/octet-stream)' });
  }
  const tmpPath = SERVER_CONFIG.dbPath + '.import';
  writeFileSync(tmpPath, body);
  const preCounts = db.countsByTable();
  console.log('[import] received', body.length, 'bytes; replacing DB (previous counts:', JSON.stringify(preCounts), ')');
  shuttingDown = true;
  for (const t of timers) clearInterval(t);
  db.close();
  // Stale WAL/SHM sidecars from the replaced DB must not be recovered against the imported file.
  for (const suffix of ['-wal', '-shm']) {
    rmSync(SERVER_CONFIG.dbPath + suffix, { force: true });
  }
  renameSync(tmpPath, SERVER_CONFIG.dbPath);
  setTimeout(() => {
    console.log('[import] exiting for clean restart on imported DB');
    process.exit(0);
  }, 500);
  return { ok: true, bytes: body.length, replacedCounts: preCounts, note: 'process restarting to reopen imported DB' };
});

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — stopping schedulers, stream, server and DB`);
  for (const t of timers) clearInterval(t);
  // Persist any minute that is already complete before the sockets go away.
  try {
    stream.flushCandles();
  } catch {}
  stream.stop();
  for (const res of sseClients) {
    try {
      res.end();
    } catch {}
  }
  sseClients.clear();
  void app
    .close()
    .catch(() => {})
    .then(() => {
      try {
        db.close();
      } catch {}
      console.log('[shutdown] clean exit');
      process.exit(0);
    });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main(): Promise<void> {
  refreshEdgeCache();
  if (STREAM_CONFIG.enabled) {
    // Backfill first so the very first signal already has order-flow (CVD) context,
    // then give the sockets a moment so the first signal can use the consensus price.
    await backfillCandles();
    stream.start();
    // Deep history is not on the critical path for the first signal — run it in the background.
    void backfillCandleHistory();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      const off = stream.onUpdate(() => {
        clearTimeout(timer);
        off();
        resolve();
      });
    });
    timers.push(
      setInterval(() => {
        if (ssePending && sseClients.size > 0) {
          ssePending = false;
          sseBroadcast('tick', streamPayload());
        }
      }, STREAM_CONFIG.ssePushIntervalMs),
    );
  }
  await computeSignals();
  await refreshNews();
  await refreshDerivatives();
  evaluateDueSignals();
  timers.push(setInterval(computeSignals, REFRESH_INTERVALS_MS.signalCompute));
  timers.push(setInterval(refreshNews, REFRESH_INTERVALS_MS.news));
  timers.push(setInterval(refreshDerivatives, REFRESH_INTERVALS_MS.derivatives));
  timers.push(setInterval(evaluateDueSignals, EVALUATION_CONFIG.jobIntervalMs));
  timers.push(setInterval(() => db.pruneOldData(30 * 24 * 3_600_000), 6 * 3_600_000));
  timers.push(
    setInterval(() => {
      const c = db.countsByTable();
      const st = stream.status();
      console.log('[heartbeat]', JSON.stringify({ signals: c.signals, evaluations: c.evaluations, snapshots: c.polymarket_history, candles: c.btc_candles_1m, derivatives: c.derivatives_history, stream: st.freshness, cvd: stream.cvd().ratio1h, sse: sseClients.size, edge: edgeCache ? Object.fromEntries(HORIZONS.map((h) => [h, edgeCache!.stats[h].status])) : null }));
    }, 3_600_000),
  );
  schedulersStarted = true;

  await app.listen({ port: SERVER_CONFIG.port, host: SERVER_CONFIG.host });
  console.log(`[server] listening on http://${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
