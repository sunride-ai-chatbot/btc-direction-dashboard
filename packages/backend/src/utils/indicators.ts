export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let current = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(current);
  for (let i = period; i < values.length; i++) {
    current = values[i] * k + current * (1 - k);
    out.push(current);
  }
  return out;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { line: number; signal: number; histogram: number } | null {
  if (closes.length < slow + signalPeriod) return null;
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  const offset = fastSeries.length - slowSeries.length;
  const macdLine = slowSeries.map((s, i) => fastSeries[i + offset] - s);
  const signalSeries = emaSeries(macdLine, signalPeriod);
  if (signalSeries.length === 0) return null;
  const line = macdLine[macdLine.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  return { line, signal, histogram: line - signal };
}

/** Annualized-ish volatility proxy: stddev of hourly log returns over window, as % */
export function volatility(closes: number[], window = 24): number | null {
  if (closes.length < window + 1) return null;
  const slice = closes.slice(-window - 1);
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    returns.push(Math.log(slice[i] / slice[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}
