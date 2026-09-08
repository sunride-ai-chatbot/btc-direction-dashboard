import { clamp } from '../utils/indicators.js';
import type {
  BitcoinTechnicals,
  ComponentScore,
  EtfFlows,
  Horizon,
  LiquidityContext,
  MacroData,
  PolymarketSnapshot,
} from '../types.js';

const HORIZON_WINDOW_MINUTES: Record<Horizon, number> = { '1h': 60, '4h': 240, '24h': 1440, '72h': 1440 };

/**
 * Polymarket score: weighted average of per-market directional moves.
 * Each market contributes bullishDirection * probChange (percentage points),
 * scaled so a 5pp move ≈ ±50.
 * Weight = relevance * informationValue * log10(1+liquidity) * persistenceFactor —
 * liquid, informative markets with smooth (non-choppy) probability paths dominate.
 * Missing history is NEVER treated as zero change: such markets are skipped and
 * the cold-start state is reported explicitly.
 */
export function scorePolymarket(snapshot: PolymarketSnapshot, horizon: Horizon): ComponentScore {
  const reasons: string[] = [];
  const risks: string[] = [];

  if (snapshot.freshness === 'unavailable' || snapshot.markets.length === 0) {
    return unavailable('Polymarket data unavailable', snapshot.freshness);
  }

  const changeField = horizon === '1h' ? 'probChange1h' : horizon === '4h' ? 'probChange4h' : 'probChange24h';
  const windowMinutes = HORIZON_WINDOW_MINUTES[horizon];
  const limitedHistory = snapshot.historyMinutes < windowMinutes;

  let weightedSum = 0;
  let totalWeight = 0;
  const contributions: Array<{
    title: string; category: string; contribution: number; changePp: number;
    liquidity: number; infoValue: number; id: string; probability: number;
  }> = [];
  const categoryAgg: Record<string, { sum: number; weight: number }> = {};

  for (const m of snapshot.markets) {
    let change = m[changeField];
    // 1h cold-start mitigation only: extrapolate nothing, just use the shorter
    // real 15m observation when the 1h delta does not exist yet.
    if (change === null && horizon === '1h') change = m.probChange15m;
    if (change === null) continue;

    const persistenceFactor = m.persistence === null ? 1 : 0.7 + 0.3 * m.persistence;
    const weight = m.relevanceScore * m.informationValue * Math.log10(1 + Math.max(m.liquidity, m.volume)) * persistenceFactor;
    if (weight <= 0) continue;
    const marketScore = clamp(m.bullishDirection * change * 100 * 10, -100, 100);
    weightedSum += marketScore * weight;
    totalWeight += weight;
    contributions.push({
      id: m.id, title: m.title, category: m.category, contribution: marketScore * weight,
      changePp: change * 100, liquidity: m.liquidity, infoValue: m.informationValue, probability: m.probability,
    });
    const agg = (categoryAgg[m.category] ??= { sum: 0, weight: 0 });
    agg.sum += marketScore * weight;
    agg.weight += weight;
  }

  const historyNote = limitedHistory
    ? `Polymarket ${horizon === '1h' ? '1h' : horizon === '4h' ? '4h' : '24h'} momentum limited — only ${snapshot.historyMinutes} minutes of history collected`
    : null;

  if (totalWeight === 0) {
    return {
      score: 0,
      weight: 0,
      available: true,
      freshness: snapshot.freshness,
      details: {
        marketsTracked: snapshot.markets.length,
        marketsWithHistory: 0,
        historyMinutes: snapshot.historyMinutes,
        limitedHistory: true,
        note: 'no probability history yet for this window — score withheld, not assumed zero',
      },
      reasons: [`Tracking ${snapshot.markets.length} Polymarket markets — building probability history (${snapshot.historyMinutes}m collected)`],
      risks: [historyNote ?? 'Polymarket change data not yet accumulated for this horizon'],
    };
  }

  const score = clamp(weightedSum / totalWeight, -100, 100);
  const categoryScores = Object.fromEntries(
    Object.entries(categoryAgg).map(([cat, a]) => [cat, +(a.sum / a.weight).toFixed(1)]),
  );

  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const top = contributions.slice(0, 3);
  for (const c of top.slice(0, 2)) {
    if (Math.abs(c.changePp) >= 0.5) {
      const dir = c.contribution > 0 ? 'bullish' : 'bearish';
      reasons.push(`"${truncate(c.title, 55)}" moved ${c.changePp > 0 ? '+' : ''}${c.changePp.toFixed(1)}pp (${dir} for BTC)`);
    }
  }
  if (reasons.length === 0) {
    reasons.push(`Polymarket probabilities broadly stable across ${contributions.length} tracked markets`);
  }

  const conflicting = contributions.filter((c) => Math.sign(c.contribution) !== Math.sign(score) && Math.abs(c.changePp) > 1);
  if (conflicting.length > 0) {
    risks.push(`${conflicting.length} Polymarket market(s) moving against the aggregate signal`);
  }
  if (limitedHistory && historyNote) risks.push(historyNote);

  return {
    score,
    weight: 0,
    available: true,
    freshness: snapshot.freshness,
    details: {
      marketsTracked: snapshot.markets.length,
      marketsWithHistory: contributions.length,
      historyMinutes: snapshot.historyMinutes,
      limitedHistory,
      categoryScores,
      marketsUsed: contributions.map((c) => ({
        id: c.id, title: c.title, category: c.category, probability: c.probability,
        changeUsedPp: +c.changePp.toFixed(2), informationValue: +c.infoValue.toFixed(3), liquidity: c.liquidity,
      })),
      topContributors: top.map((c) => ({ title: c.title, changePp: +c.changePp.toFixed(2), infoValue: +c.infoValue.toFixed(2) })),
    },
    reasons,
    risks,
  };
}

export function scoreTechnical(tech: BitcoinTechnicals, horizon: Horizon): ComponentScore {
  const reasons: string[] = [];
  const risks: string[] = [];

  if (tech.freshness === 'unavailable') {
    return unavailable('BTC price data unavailable', 'unavailable');
  }

  const parts: Array<{ value: number; weight: number }> = [];

  const momentumChange = horizon === '1h' ? tech.change1h : horizon === '4h' ? tech.change4h : tech.change24h;
  const momentumScale = horizon === '1h' ? 40 : horizon === '4h' ? 25 : 12;
  if (momentumChange !== null) {
    const momentumScore = clamp(momentumChange * momentumScale, -100, 100);
    parts.push({ value: momentumScore, weight: 0.35 });
    if (Math.abs(momentumChange) > 0.3) {
      reasons.push(`BTC ${momentumChange > 0 ? 'up' : 'down'} ${Math.abs(momentumChange).toFixed(1)}% over ${horizon}`);
    }
  }

  if (tech.rsi14 !== null) {
    const rsiScore = clamp((tech.rsi14 - 50) * 2.5, -100, 100);
    parts.push({ value: rsiScore, weight: 0.2 });
    if (tech.rsi14 > 72) risks.push(`RSI ${tech.rsi14.toFixed(0)} — overbought, pullback risk`);
    else if (tech.rsi14 < 28) risks.push(`RSI ${tech.rsi14.toFixed(0)} — oversold, bounce risk against shorts`);
  }

  if (tech.ema20 !== null && tech.ema50 !== null) {
    let emaScore = 0;
    if (tech.price > tech.ema20) emaScore += 35;
    else emaScore -= 35;
    if (tech.price > tech.ema50) emaScore += 25;
    else emaScore -= 25;
    if (tech.ema200 !== null) {
      if (tech.price > tech.ema200) emaScore += 15;
      else emaScore -= 15;
    }
    if (tech.ema20 > tech.ema50) emaScore += 25;
    else emaScore -= 25;
    parts.push({ value: clamp(emaScore, -100, 100), weight: 0.25 });

    if (tech.price > tech.ema20 && tech.ema20 > tech.ema50) {
      reasons.push('BTC trading above EMA20 and EMA50 (bullish alignment)');
    } else if (tech.price < tech.ema20 && tech.ema20 < tech.ema50) {
      reasons.push('BTC trading below EMA20 and EMA50 (bearish alignment)');
    }
    if (tech.ema200 !== null) {
      const dist = ((tech.price - tech.ema200) / tech.ema200) * 100;
      if (Math.abs(dist) < 1.5) risks.push('BTC hovering near EMA200 — a key battleground level');
    }
  }

  if (tech.macd !== null) {
    const macdScore = clamp(tech.macd.histogram * 50, -100, 100);
    parts.push({ value: macdScore, weight: 0.1 });
    if (tech.macd.histogram > 0 && tech.macd.line > 0) reasons.push('MACD positive and above signal line');
  }

  if (tech.volumeChange24h !== null && momentumChange !== null) {
    const volConfirm = tech.volumeChange24h > 10 ? Math.sign(momentumChange) * 40 : 0;
    parts.push({ value: volConfirm, weight: 0.1 });
    if (tech.volumeChange24h > 25 && momentumChange > 0) reasons.push(`Volume up ${tech.volumeChange24h.toFixed(0)}% confirming the move`);
    if (tech.volumeChange24h < -30) risks.push('24h volume shrinking — weak conviction behind current price');
  }

  if (parts.length === 0) {
    return {
      score: 0,
      weight: 0,
      available: true,
      freshness: tech.freshness,
      details: { price: tech.price, source: tech.source, note: 'price only, indicators unavailable' },
      reasons: ['BTC price available but technical indicators could not be computed'],
      risks: ['Technical signal limited to price-only data'],
    };
  }

  const totalW = parts.reduce((a, p) => a + p.weight, 0);
  const score = clamp(parts.reduce((a, p) => a + p.value * p.weight, 0) / totalW, -100, 100);

  if (tech.volatility24h !== null && tech.volatility24h > 1.2) {
    risks.push(`Elevated hourly volatility (${tech.volatility24h.toFixed(2)}%) — moves may overshoot both ways`);
  }

  return {
    score,
    weight: 0,
    available: true,
    freshness: tech.freshness,
    details: {
      price: tech.price,
      rsi14: round(tech.rsi14),
      ema20: round(tech.ema20),
      ema50: round(tech.ema50),
      ema200: round(tech.ema200),
      macdHistogram: tech.macd ? +tech.macd.histogram.toFixed(2) : null,
      change24h: round(tech.change24h),
      source: tech.source,
    },
    reasons,
    risks,
  };
}

/** ETF score: $100M/day net flow ≈ ±20; rolling flows weighted higher than today's partial number. */
export function scoreEtf(etf: EtfFlows): ComponentScore {
  if (!etf.available || etf.freshness === 'unavailable') {
    return unavailable('ETF flow data unavailable (no free real-time source configured)', 'unavailable');
  }

  const reasons: string[] = [];
  const risks: string[] = [];
  const parts: Array<{ value: number; weight: number }> = [];

  if (etf.rolling5Day !== null) parts.push({ value: clamp(etf.rolling5Day / 25_000_000, -100, 100), weight: 0.4 });
  if (etf.rolling3Day !== null) parts.push({ value: clamp(etf.rolling3Day / 15_000_000, -100, 100), weight: 0.35 });
  if (etf.netFlowPrevDay !== null) parts.push({ value: clamp(etf.netFlowPrevDay / 5_000_000, -100, 100), weight: 0.25 });

  if (parts.length === 0) {
    return unavailable('ETF flow file present but contains no usable rows', etf.freshness);
  }

  const totalW = parts.reduce((a, p) => a + p.weight, 0);
  const score = clamp(parts.reduce((a, p) => a + p.value * p.weight, 0) / totalW, -100, 100);

  if (etf.rolling5Day !== null) {
    const m = etf.rolling5Day / 1_000_000;
    if (m > 100) reasons.push(`ETF 5-day net inflows +$${m.toFixed(0)}M`);
    else if (m < -100) reasons.push(`ETF 5-day net outflows $${m.toFixed(0)}M`);
  }
  if (score < -10) risks.push('ETF flows negative — institutional demand weak');
  if (etf.freshness === 'stale') risks.push('ETF flow data is stale (source not recently updated)');

  return {
    score,
    weight: 0,
    available: true,
    freshness: etf.freshness,
    details: {
      netFlowToday: etf.netFlowToday,
      netFlowPrevDay: etf.netFlowPrevDay,
      rolling3Day: etf.rolling3Day,
      rolling5Day: etf.rolling5Day,
      dataDate: etf.dataDate,
      source: etf.source,
    },
    reasons,
    risks,
  };
}

export function scoreMacro(macro: MacroData): ComponentScore {
  if (!macro.available || macro.freshness === 'unavailable') {
    return unavailable('Macro data unavailable', 'unavailable');
  }

  const reasons: string[] = [];
  const risks: string[] = [];
  const parts: Array<{ value: number; weight: number }> = [];

  if (macro.dxyChange24h !== null) {
    parts.push({ value: clamp(-macro.dxyChange24h * 60, -100, 100), weight: 0.35 });
    if (macro.dxyChange24h < -0.3) reasons.push(`Dollar index falling (${macro.dxyChange24h.toFixed(2)}%) — supportive for BTC`);
    if (macro.dxyChange24h > 0.3) risks.push(`Dollar index rising (+${macro.dxyChange24h.toFixed(2)}%) — headwind for BTC`);
  }

  if (macro.fedCutProbability !== null) {
    parts.push({ value: clamp((macro.fedCutProbability - 0.5) * 160, -100, 100), weight: 0.45 });
    if (macro.fedCutProbability > 0.6) reasons.push(`Fed-cut probability at ${(macro.fedCutProbability * 100).toFixed(0)}% on prediction markets`);
    if (macro.fedCutProbability < 0.35) risks.push('Markets pricing low odds of Fed easing');
  }

  if (macro.us10y !== null && macro.us2y !== null) {
    parts.push({ value: 0, weight: 0.2 });
  }

  if (parts.length === 0) {
    return unavailable('Macro sources returned no usable values', macro.freshness);
  }

  const totalW = parts.reduce((a, p) => a + p.weight, 0);
  const score = clamp(parts.reduce((a, p) => a + p.value * p.weight, 0) / totalW, -100, 100);

  const nextEvent = macro.upcomingEvents[0];
  if (nextEvent) {
    risks.push(`Upcoming: ${nextEvent.name} (${nextEvent.date}) may reprice markets quickly`);
  }

  return {
    score,
    weight: 0,
    available: true,
    freshness: macro.freshness,
    details: {
      dxy: macro.dxy,
      dxyChange24h: round(macro.dxyChange24h),
      us2y: macro.us2y,
      us10y: macro.us10y,
      fedCutProbability: macro.fedCutProbability,
      upcomingEvents: macro.upcomingEvents,
      source: macro.source,
    },
    reasons,
    risks,
  };
}

/**
 * Liquidity/session component. Deliberately returns direction score 0 —
 * time-of-day must never predict direction, only modify confidence
 * (applied in the confidence calculation via sessionQuality/volumeQuality).
 */
export function scoreLiquidity(ctx: LiquidityContext): ComponentScore {
  const reasons: string[] = [];
  const risks: string[] = [];

  if (ctx.sessionQuality >= 0.9) reasons.push(`${ctx.sessionName} — deep liquidity window`);
  if (ctx.sessionQuality <= 0.4) risks.push(`${ctx.sessionName} — signals during thin hours are less reliable`);
  if (ctx.volumeQuality <= 0.4) risks.push('BTC trading volume unusually low right now');

  return {
    score: 0,
    weight: 0,
    available: true,
    freshness: 'fresh',
    details: {
      session: ctx.sessionName,
      sessionQuality: ctx.sessionQuality,
      volumeQuality: ctx.volumeQuality,
      israelHour: ctx.israelHour,
    },
    reasons,
    risks,
  };
}

function unavailable(reason: string, freshness: 'fresh' | 'stale' | 'unavailable'): ComponentScore {
  return {
    score: 0,
    weight: 0,
    available: false,
    freshness,
    details: {},
    reasons: [],
    risks: [reason],
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function round(v: number | null): number | null {
  return v === null ? null : +v.toFixed(2);
}
