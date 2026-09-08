import { HORIZONS } from '../types.js';
import type { CvdSnapshot, Horizon, PolymarketSnapshot, PriceConsensus, SignalBundle, SignalLabel } from '../types.js';
import type { PolymarketProvider } from '../providers/polymarket.js';
import type { BitcoinPriceProvider } from '../providers/bitcoin.js';
import type { EtfProvider } from '../providers/etf.js';
import type { MacroProvider } from '../providers/macro.js';
import { classifySession, computeVolumeQuality, getLiquidityContext } from '../providers/liquidity.js';
import { scoreEtf, scoreLiquidity, scoreMacro, scorePolymarket, scoreTechnical } from './scorers.js';
import { buildSignal, type SignalEnrichment } from './engine.js';

export interface PipelineProviders {
  polymarket: PolymarketProvider;
  bitcoin: BitcoinPriceProvider;
  etf: EtfProvider;
  macro: MacroProvider;
}

export interface PipelineResult {
  bundle: SignalBundle;
  polySnapshot: PolymarketSnapshot;
  tech: import('../types.js').BitcoinTechnicals;
}

/** Live evidence injected by the server: stream consensus, order flow, and per-horizon edge/conformal layers. */
export interface PipelineExtras {
  consensus?: PriceConsensus | null;
  cvd?: CvdSnapshot | null;
  enrichFor?: (horizon: Horizon) => Omit<SignalEnrichment, 'priceAnomaly' | 'livePrice'>;
}

/**
 * Runs one full scoring pass. Individual provider failures are absorbed by
 * each provider's own fallback logic — the pipeline never throws for a dead source.
 * Fed-cut probability for the macro component is derived from Polymarket fed markets.
 * prevStableLabels feeds label hysteresis (bootstrapped from the DB on restart).
 * When a fresh multi-exchange consensus price exists it replaces the REST price
 * (fresher, median-robust); the REST kline series still drives the indicators.
 */
export async function runPipeline(
  providers: PipelineProviders,
  prevStableLabels: Partial<Record<Horizon, SignalLabel>> = {},
  extras: PipelineExtras = {},
): Promise<PipelineResult> {
  const now = Date.now();
  const [polySnapshot, tech, etf, macro] = await Promise.all([
    providers.polymarket.fetchSnapshot(),
    providers.bitcoin.fetchTechnicals(),
    providers.etf.fetchFlows(),
    providers.macro.fetchMacro(),
  ]);

  const fedMarkets = polySnapshot.markets.filter((m) => m.category === 'fed' && m.bullishDirection === 1);
  if (fedMarkets.length > 0 && macro.available) {
    const totalLiq = fedMarkets.reduce((a, m) => a + m.liquidity, 0);
    if (totalLiq > 0) {
      macro.fedCutProbability = fedMarkets.reduce((a, m) => a + m.probability * m.liquidity, 0) / totalLiq;
    }
  }

  const consensus = extras.consensus ?? null;
  const liveConsensus = consensus !== null && consensus.price !== null && consensus.freshExchanges > 0;
  if (liveConsensus && tech.freshness !== 'unavailable') {
    tech.price = consensus.price!;
    if (tech.freshness === 'stale') tech.freshness = 'fresh';
  }

  const volumeQuality = computeVolumeQuality(tech.volume24h, tech.volumeChange24h);
  const liquidityCtx = getLiquidityContext(new Date(now), volumeQuality);
  const session = classifySession(now);

  const btcPrice = tech.freshness !== 'unavailable' && tech.price > 0 ? tech.price : null;
  const priceAnomaly = consensus ? { anomaly: consensus.anomaly, note: consensus.anomalyNote, spreadPct: consensus.spreadPct } : null;
  const livePrice = liveConsensus ? { source: 'consensus' as const, exchanges: consensus!.freshExchanges } : { source: 'rest' as const, exchanges: 0 };

  const signals = {} as SignalBundle['signals'];
  for (const horizon of HORIZONS) {
    const components = {
      polymarket: scorePolymarket(polySnapshot, horizon),
      technical: scoreTechnical(tech, horizon, extras.cvd ?? null),
      etf: scoreEtf(etf),
      macro: scoreMacro(macro),
      liquidity: scoreLiquidity(liquidityCtx),
    };
    const enrichment: SignalEnrichment = { ...(extras.enrichFor?.(horizon) ?? {}), priceAnomaly, livePrice };
    signals[horizon as Horizon] = buildSignal(
      components,
      horizon,
      liquidityCtx,
      btcPrice,
      now,
      prevStableLabels[horizon] ?? null,
      session,
      enrichment,
    );
  }

  return { bundle: { signals, generatedAt: now }, polySnapshot, tech };
}
