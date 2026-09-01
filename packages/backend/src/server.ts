import Fastify from 'fastify';
import cors from '@fastify/cors';
import { SignalDatabase } from './db/database.js';
import { GammaPolymarketProvider } from './providers/polymarket.js';
import { BinanceBitcoinProvider } from './providers/bitcoin.js';
import { ManualFileEtfProvider } from './providers/etf.js';
import { FredMacroProvider } from './providers/macro.js';
import { runPipeline, type PipelineProviders } from './scoring/pipeline.js';
import { evaluateHorizon } from './scoring/evaluation.js';
import { AlertEngine, DatabaseAlertSink } from './alerts/engine.js';
import { cached } from './utils/cached.js';
import { REFRESH_INTERVALS_MS, SERVER_CONFIG, HORIZON_WEIGHTS } from './config.js';
import { HORIZONS, type Horizon, type SignalBundle, type PolymarketSnapshot } from './types.js';

const db = new SignalDatabase(SERVER_CONFIG.dbPath);

const polymarketProvider = new GammaPolymarketProvider(db);
const bitcoinProvider = new BinanceBitcoinProvider();
const etfProvider = new ManualFileEtfProvider();
const macroProvider = new FredMacroProvider();

const providers: PipelineProviders = {
  polymarket: { fetchSnapshot: cached(() => polymarketProvider.fetchSnapshot(), REFRESH_INTERVALS_MS.polymarket) },
  bitcoin: { fetchTechnicals: cached(() => bitcoinProvider.fetchTechnicals(), REFRESH_INTERVALS_MS.btcPrice) },
  etf: { fetchFlows: cached(() => etfProvider.fetchFlows(), REFRESH_INTERVALS_MS.etf) },
  macro: { fetchMacro: cached(() => macroProvider.fetchMacro(), REFRESH_INTERVALS_MS.macro) },
};

const alertEngine = new AlertEngine();
alertEngine.addSink(new DatabaseAlertSink(db));

let latestBundle: SignalBundle | null = null;
let latestPolySnapshot: PolymarketSnapshot | null = null;
let lastPersistTs = 0;
const PERSIST_INTERVAL_MS = 5 * 60_000;

async function computeSignals(): Promise<void> {
  try {
    const { bundle, polySnapshot, tech } = await runPipeline(providers);
    latestBundle = bundle;
    latestPolySnapshot = polySnapshot;

    if (tech.freshness === 'fresh' && tech.price > 0) {
      db.insertBtcPrice(bundle.generatedAt, tech.price, tech.volume24h);
    }

    const shouldPersist = bundle.generatedAt - lastPersistTs >= PERSIST_INTERVAL_MS;
    if (shouldPersist) {
      for (const horizon of HORIZONS) {
        db.insertSignal(bundle.signals[horizon]);
      }
      lastPersistTs = bundle.generatedAt;
    }

    alertEngine.evaluate(bundle, polySnapshot, tech);
  } catch (err) {
    console.error('[pipeline] compute failed:', err);
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
    })),
  };
});

app.get('/api/evaluation', async () => {
  return { reports: HORIZONS.map((h) => evaluateHorizon(db, h)) };
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

async function main(): Promise<void> {
  await computeSignals();
  setInterval(computeSignals, REFRESH_INTERVALS_MS.signalCompute);
  setInterval(() => db.pruneOldData(30 * 24 * 3_600_000), 6 * 3_600_000);

  await app.listen({ port: SERVER_CONFIG.port, host: SERVER_CONFIG.host });
  console.log(`[server] listening on http://${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
