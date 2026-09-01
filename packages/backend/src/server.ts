import Fastify from 'fastify';
import cors from '@fastify/cors';
import { SignalDatabase } from './db/database.js';
import { GammaPolymarketProvider } from './providers/polymarket.js';
import { BinanceBitcoinProvider } from './providers/bitcoin.js';
import { ManualFileEtfProvider } from './providers/etf.js';
import { FredMacroProvider } from './providers/macro.js';
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

const db = new SignalDatabase(SERVER_CONFIG.dbPath);
const health = new HealthRegistry();

const polymarketProvider = new GammaPolymarketProvider(db);
const bitcoinProvider = new BinanceBitcoinProvider();
const etfProvider = new ManualFileEtfProvider();
const macroProvider = new FredMacroProvider();

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
// Survive restarts: hysteresis continues from the last persisted labels and the
// persist cadence continues from the last stored signal timestamp.
let stableLabels: Partial<Record<Horizon, SignalLabel>> = db.getLatestLabels();
let lastPersistTs = db.getMaxSignalTs();
const PERSIST_INTERVAL_MS = 5 * 60_000;

async function computeSignals(): Promise<void> {
  try {
    const { bundle, polySnapshot, tech } = await runPipeline(providers, stableLabels);
    latestBundle = bundle;
    latestPolySnapshot = polySnapshot;
    for (const horizon of HORIZONS) stableLabels[horizon] = bundle.signals[horizon].label;

    if (tech.freshness === 'fresh' && tech.price > 0) {
      db.insertBtcPrice(bundle.generatedAt, tech.price, tech.volume24h);
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
    }

    alertEngine.evaluate(bundle, polySnapshot, tech);
  } catch (err) {
    console.error('[pipeline] compute failed:', err);
  }
}

function evaluateDueSignals(): void {
  try {
    const { evaluated } = runEvaluationPass(db);
    if (evaluated > 0) console.log(`[evaluator] evaluated ${evaluated} signal(s); total ${db.countEvaluations()}`);
  } catch (err) {
    console.error('[evaluator] pass failed:', err);
  }
}

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

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

app.get('/api/health', async () => {
  const snap = health.snapshot({ polymarket: 'realtime', 'btc-price': 'realtime', macro: 'daily', etf: 'manual' });
  return {
    ...snap,
    serverTime: Date.now(),
    evaluationsStored: db.countEvaluations(),
    neutralThresholdsPct: NEUTRAL_THRESHOLD_PCT,
    evaluationJobMs: EVALUATION_CONFIG.jobIntervalMs,
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
};

app.get<{ Params: { file: string } }>('/api/export/:file', async (req, reply) => {
  const exporter = EXPORTS[req.params.file];
  if (!exporter) return reply.code(404).send({ error: 'Unknown export. Available: ' + Object.keys(EXPORTS).join(', ') });
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="${req.params.file}"`);
  return toCsv(exporter());
});

async function main(): Promise<void> {
  await computeSignals();
  evaluateDueSignals();
  setInterval(computeSignals, REFRESH_INTERVALS_MS.signalCompute);
  setInterval(evaluateDueSignals, EVALUATION_CONFIG.jobIntervalMs);
  setInterval(() => db.pruneOldData(30 * 24 * 3_600_000), 6 * 3_600_000);

  await app.listen({ port: SERVER_CONFIG.port, host: SERVER_CONFIG.host });
  console.log(`[server] listening on http://${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
