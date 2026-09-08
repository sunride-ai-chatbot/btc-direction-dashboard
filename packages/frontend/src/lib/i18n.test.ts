import { describe, expect, it } from 'vitest';
import { en, he, translate, type TranslationKey } from './i18n';
import { translateDynamic } from './dynamicHe';

describe('translation dictionary coverage', () => {
  it('Hebrew covers every English key', () => {
    const enKeys = Object.keys(en).sort();
    const heKeys = Object.keys(he).sort();
    expect(heKeys).toEqual(enKeys);
  });

  it('no Hebrew value is empty or identical to English (except proper names/tickers)', () => {
    const allowedSame = new Set(['nav.polymarket', 'comp.polymarket', 'health.provider.polymarket', 'pm.csv', 'eval.n']);
    for (const key of Object.keys(en) as TranslationKey[]) {
      expect(he[key], key).toBeTruthy();
      if (!allowedSame.has(key)) {
        expect(he[key], `key ${key} should be translated`).not.toBe(en[key]);
      }
    }
  });

  it('interpolation fills every placeholder in both languages', () => {
    for (const lang of ['en', 'he'] as const) {
      const out = translate(lang, 'eval.warning', { min: 50, n: 111 });
      expect(out).toContain('50');
      expect(out).toContain('111');
      expect(out).not.toContain('{min}');
      expect(out).not.toContain('{n}');
    }
  });
});

describe('dynamic explanation translation (backend templates)', () => {
  const samples: Array<{ en: string; heContains: string }> = [
    { en: 'BTC up 2.6% over 24h', heContains: 'עלה' },
    { en: 'BTC down 0.8% over 1h', heContains: 'ירד' },
    { en: 'BTC trading above EMA20 and EMA50 (bullish alignment)', heContains: 'EMA50' },
    { en: 'MACD positive and above signal line', heContains: 'MACD' },
    { en: 'Volume up 27% confirming the move', heContains: 'מחזור' },
    { en: '24h volume shrinking — weak conviction behind current price', heContains: 'מתכווץ' },
    { en: 'RSI 74 — overbought, pullback risk', heContains: 'קניית-יתר' },
    { en: 'RSI 22 — oversold, bounce risk against shorts', heContains: 'מכירת-יתר' },
    { en: 'BTC hovering near EMA200 — a key battleground level', heContains: 'EMA200' },
    { en: 'Elevated hourly volatility (1.31%) — moves may overshoot both ways', heContains: 'תנודתיות' },
    { en: 'BTC price data unavailable', heContains: 'זמינים' },
    { en: '"Will Bitcoin reach $150,000 by June 30?" moved +7.0pp (bullish for BTC)', heContains: 'שורי' },
    { en: 'Polymarket probabilities broadly stable across 12 tracked markets', heContains: 'יציבות' },
    { en: '3 Polymarket market(s) moving against the aggregate signal', heContains: 'נגד' },
    { en: 'Tracking 14 Polymarket markets — building probability history (38m collected)', heContains: 'במעקב' },
    { en: 'Polymarket change data not yet accumulated for this horizon', heContains: 'טרם' },
    { en: 'Polymarket 24h momentum limited — only 47 minutes of history collected', heContains: 'מוגבל' },
    { en: 'Limited-history signal: Polymarket deltas for this horizon rest on 47 minutes of collected snapshots', heContains: 'חלקית' },
    { en: 'Polymarket data unavailable', heContains: 'זמינים' },
    { en: 'ETF 5-day net inflows +$410M', heContains: 'ETF' },
    { en: 'ETF flows negative — institutional demand weak', heContains: 'מוסדי' },
    { en: 'ETF flow data is stale (source not recently updated)', heContains: 'מיושנים' },
    { en: 'Dollar index falling (-0.45%) — supportive for BTC', heContains: 'הדולר' },
    { en: 'Dollar index rising (+0.33%) — headwind for BTC', heContains: 'רוח נגדית' },
    { en: 'Fed-cut probability at 62% on prediction markets', heContains: 'הפד' },
    { en: 'Markets pricing low odds of Fed easing', heContains: 'הפד' },
    { en: 'Upcoming: FOMC meeting (2026-09-16) may reprice markets quickly', heContains: 'FOMC' },
    { en: 'EU/US overlap — deep liquidity window', heContains: 'נזילות' },
    { en: 'Overnight (thin liquidity) — signals during thin hours are less reliable', heContains: 'לילה' },
    { en: 'BTC trading volume unusually low right now', heContains: 'נמוך' },
    { en: 'No strong directional evidence — signals are mixed or flat', heContains: 'עדות' },
    { en: 'Crypto markets can reprice sharply on unexpected news at any time', heContains: 'קריפטו' },
    { en: 'BTC down 1.2% over 4h while Polymarket sentiment shifted bullish (+12) — possible bullish divergence', heContains: 'סטייה שורית' },
    { en: 'BTC up 1.5% over 4h while Polymarket sentiment deteriorated (-9) — possible bearish divergence', heContains: 'סטייה דובית' },
    { en: '24h signal flipped NEUTRAL → BULLISH (score 31.5)', heContains: 'התהפך' },
    { en: '24h confidence moved 41 → 62', heContains: 'ביטחון' },
    { en: 'BTC 24h volume spiked 120% vs previous check', heContains: 'זינק' },
  ];

  it('translates every known backend template into Hebrew', () => {
    for (const s of samples) {
      const out = translateDynamic(s.en, 'he');
      expect(out, s.en).not.toBe(s.en);
      expect(out, s.en).toContain(s.heContains);
    }
  });

  it('preserves numbers and tickers in translated output', () => {
    expect(translateDynamic('BTC up 2.6% over 24h', 'he')).toContain('2.6');
    expect(translateDynamic('RSI 74 — overbought, pullback risk', 'he')).toContain('74');
    const m = translateDynamic('"Will Bitcoin reach $150,000 by June 30?" moved +7.0pp (bullish for BTC)', 'he');
    expect(m).toContain('Will Bitcoin reach $150,000 by June 30?');
    expect(m).toContain('+7.0');
  });

  it('returns English unchanged for lang=en', () => {
    expect(translateDynamic('BTC up 2.6% over 24h', 'en')).toBe('BTC up 2.6% over 24h');
  });

  it('passes unknown strings through untouched (backward compatibility)', () => {
    const legacy = 'Some legacy explanation text from an old version';
    expect(translateDynamic(legacy, 'he')).toBe(legacy);
  });
});
