import { HORIZONS } from '../types.js';
import type { Horizon, PolymarketSnapshot, SignalBundle, SignalLabel } from '../types.js';
import type { PolymarketProvider } from '../providers/polymarket.js';
import type { BitcoinPriceProvider } from '../providers/bitcoin.js';
import type { EtfProvider } from '../providers/etf.js';
import type { MacroProvider } from '../providers/macro.js';
import { classifySession, computeVolumeQuality, getLiquidityContext } from '../providers/liquidity.js';
import { scoreEtf, scoreLiquidity, scoreMacro, scorePolymarket, scoreTechnical } from './scorers.js';
import { buildSignal } from './engine.js';

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

/**
 * Runs one full scoring pass. Individual provider failures are absorbed by
 * each provider's own fallback logic — the pipeline never throws for a dead source.
 * Fed-cut probability for the macro component is derived from Polymarket fed markets.
 * prevStableLabels feeds label hysteresis (bootstrapped from the DB on restart).
 */
export async function runPipeline(
  providers: PipelineProviders,
  prevStableLabels: Partial<Record<Horizon, SignalLabel>> = {},
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

  const volumeQuality = computeVolumeQuality(tech.volume24h, tech.volumeChange24h);
  const liquidityCtx = getLiquidityContext(new Date(now), volumeQuality);
  const session = classifySession(now);

  const btcPrice = tech.freshness !== 'unavailable' && tech.price > 0 ? tech.price : null;

  const signals = {} as SignalBundle['signals'];
  for (const horizon of HORIZONS) {
    const components = {
      polymarket: scorePolymarket(polySnapshot, horizon),
      technical: scoreTechnical(tech, horizon),
      etf: scoreEtf(etf),
      macro: scoreMacro(macro),
      liquidity: scoreLiquidity(liquidityCtx),
    };
    signals[horizon as Horizon] = buildSignal(
      components,
      horizon,
      liquidityCtx,
      btcPrice,
      now,
      prevStableLabels[horizon] ?? null,
      session,
    );
  }

  return { bundle: { signals, generatedAt: now }, polySnapshot, tech };
}
