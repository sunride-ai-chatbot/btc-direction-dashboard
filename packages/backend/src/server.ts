import Fastify from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { SignalDatabase } from './db/database.js';
import { GammaPolymarketProvider } from './providers/polymarket.js';
import { BinanceBitcoinProvider } from './providers/bitcoin.js';
import { ManualFileEtfProvider, SosoValueEtfProvider } from './providers/etf.js';
import { FredMacroProvider } from './providers/macro.js';
import { CmcNewsProvider, type CmcNewsSnapshot } from './providers/cmcNews.js';
import { runPipeline, type PipelineProviders } from './scoring/pipeline.js';
import { runEvaluationPass } from './scoring/evaluator.js';
import { buildAttributionReport, buildDivergenceReport, buildEvaluationReport } from './scoring/reports.js';
import { detectDivergence } from './scoring/divergence.js';
import { AlertEngine, DatabaseAlertSink } from './alerts/engine.js';
import { cached } from './utils/cached.js';
import { HealthRegistry } from './utils/health.js';
import { toCsv } from './utils/csv.js';
import { DIVERGENCE_CONFIG, EVALUATION_CONFIG, HORIZON_WEIGHTS, NEUTRAL_THRESHOLD_PCT, REFRESH_INTERVALS_MS, SERVER_CONFIG } from './config.js';
import { HORIZONS, type Horizon, type SignalBundle, type SignalLabel, type PolymarketSnapshot } from './types.js';

const startedAt = Date.now();
const db = new SignalDatabase(SERVER_CONFIG.dbPath);
const health = new HealthRegistry();

console.log('[startup] node', process.version, '| db:', SERVER_CONFIG.dbPath, '| host:', SERVER_CONFIG.host, '| port:', SERVER_CONFIG.port);
console.log('[startup] row counts:', JSON.stringify(db.countsByTable()));

const polymarketProvider = new GammaPolymarketProvider(db);
const bitcoinProvider = new BinanceBitcoinProvider();
const etfProvider = process.env.ETF_SOURCE === 'manual' ? new ManualFileEtfProvider() : new SosoValueEtfProvider(db);
const macroProvider = new FredMacroProvider();
const newsProvider = new CmcNewsProvider(db);
const fetchNews = health.instrument('cmc-news', () => newsProvider.fetchNews());

const providers: PipelineProviders = {
  polymarket: { fetchSnapshot: cached(health.instrument('polymarket', () => polymarketProvider.fetchSnapshot()), REFRESH_INTERVALS_MS.polymarket) },
  bitcoin: { fetchTechnicals: cached(health.instrument('btc-price', () => bitcoinProvider.fetchTechnicals()), REFRESH_INTERVALS_MS.btcPrice) },
  etf: { fetchFlows: cached(health.instrument('etf', () => etfProvider.fetchFlows()), REFRESH_INTERVALS_MS.etf) },
  macro: { fetchMacro: cached(health.instrument('macro', () => macroProvider.fetchMacro()), REFRESH_INTERVALS_MS.macro) },
};

const alertEngine = new AlertEngine();
alertEngine.addSink(new DatabaseAlertSink(db));

let latestBundle: SignalBundle | null = null;
let latestPolySnapshot: PolymarketSnapshot | null = null;
let latestNews: CmcNewsSnapshot | null = null;
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
    const { bundle, polySnapshot, tech } = await runPipeline(providers, stableLabels);
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

function evaluateDueSignals(): void {
  if (shuttingDown) return;
  try {
    const { evaluated } = runEvaluationPass(db);
    lastEvaluatorRunTs = Date.now();
    if (evaluated > 0) console.log(`[evaluator] evaluated ${evaluated} signal(s); total ${db.countEvaluations()}`);
  } catch (err) {
    console.error('[evaluator] pass failed:', err instanceof Error ? err.message : err);
  }
}

const app = Fastify({ logger: false, bodyLimit: 128 * 1024 * 1024 });
await app.register(cors, {
  origin: SERVER_CONFIG.corsOrigin ? SERVER_CONFIG.corsOrigin.split(',').map((s) => s.trim()) : true,
});

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
  const snap = health.snapshot({ polymarket: 'realtime', 'btc-price': 'realtime', macro: 'daily', etf: 'daily', 'cmc-news': 'realtime' });
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

app.get('/api/evaluation', async () => buildEvaluationReport(db));
app.get('/api/attribution', async () => buildAttributionReport(db));
app.get('/api/divergences', async () => buildDivergenceReport(db));

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

app.get('/api/health', async () => {
  const snap = health.snapshot({ polymarket: 'realtime', 'btc-price': 'realtime', macro: 'daily', etf: 'daily', 'cmc-news': 'realtime' });
  return {
    ...snap,
    serverTime: Date.now(),
    evaluationsStored: db.countEvaluations(),
    neutralThresholdsPct: NEUTRAL_THRESHOLD_PCT,
    evaluationJobMs: EVALUATION_CONFIG.jobIntervalMs,
    lastEvaluatorRun: lastEvaluatorRunTs,
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
  console.log(`[shutdown] ${signal} received — stopping schedulers, closing server and DB`);
  for (const t of timers) clearInterval(t);
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
  await computeSignals();
  await refreshNews();
  evaluateDueSignals();
  timers.push(setInterval(computeSignals, REFRESH_INTERVALS_MS.signalCompute));
  timers.push(setInterval(refreshNews, REFRESH_INTERVALS_MS.news));
  timers.push(setInterval(evaluateDueSignals, EVALUATION_CONFIG.jobIntervalMs));
  timers.push(setInterval(() => db.pruneOldData(30 * 24 * 3_600_000), 6 * 3_600_000));
  timers.push(
    setInterval(() => {
      const c = db.countsByTable();
      console.log('[heartbeat]', JSON.stringify({ signals: c.signals, evaluations: c.evaluations, snapshots: c.polymarket_history }));
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
