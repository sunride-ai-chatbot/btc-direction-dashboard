import type { Lang } from './i18n';

/**
 * Hebrew rendering for the backend's deterministic explanation templates
 * (reasons / risks / alert & divergence messages).
 *
 * The backend stores canonical English strings (historical records are never
 * machine-translated or rewritten). Because every explanation comes from a
 * fixed template in the scoring engine, each template has a regex here and a
 * Hebrew renderer over its captured values. Unknown strings are returned
 * unchanged (backward compatibility with any legacy/edge text).
 * Tickers and market titles deliberately stay in their original form.
 */
interface Rule {
  re: RegExp;
  he: (m: RegExpMatchArray) => string;
}

const RULES: Rule[] = [
  // --- technical ---
  { re: /^BTC (up|down) ([\d.]+)% over (\d+h)$/, he: (m) => `BTC ${m[1] === 'up' ? 'עלה' : 'ירד'} ב-${m[2]}% ב-${m[3].replace('h', ' שעות')}` },
  { re: /^BTC trading above EMA20 and EMA50 \(bullish alignment\)$/, he: () => 'BTC נסחר מעל EMA20 ו-EMA50 (מבנה שורי)' },
  { re: /^BTC trading below EMA20 and EMA50 \(bearish alignment\)$/, he: () => 'BTC נסחר מתחת ל-EMA20 ו-EMA50 (מבנה דובי)' },
  { re: /^MACD positive and above signal line$/, he: () => 'MACD חיובי ומעל קו האיתות' },
  { re: /^Volume up (\d+)% confirming the move$/, he: (m) => `המחזור עלה ${m[1]}% ומאשש את המהלך` },
  { re: /^24h volume shrinking — weak conviction behind current price$/, he: () => 'מחזור 24 שע׳ מתכווץ — שכנוע חלש מאחורי המחיר הנוכחי' },
  { re: /^RSI (\d+) — overbought, pullback risk$/, he: (m) => `RSI ${m[1]} — קניית-יתר, סיכון לתיקון` },
  { re: /^RSI (\d+) — oversold, bounce risk against shorts$/, he: (m) => `RSI ${m[1]} — מכירת-יתר, סיכון לניתור נגד שורטים` },
  { re: /^BTC hovering near EMA200 — a key battleground level$/, he: () => 'BTC מרחף סביב EMA200 — רמת מפתח קריטית' },
  { re: /^Elevated hourly volatility \(([\d.]+)%\) — moves may overshoot both ways$/, he: (m) => `תנודתיות שעתית מוגברת (${m[1]}%) — מהלכים עלולים להגזים לשני הכיוונים` },
  { re: /^BTC price available but technical indicators could not be computed$/, he: () => 'מחיר BTC זמין אך לא ניתן לחשב אינדיקטורים טכניים' },
  { re: /^Technical signal limited to price-only data$/, he: () => 'האיתות הטכני מוגבל לנתוני מחיר בלבד' },
  { re: /^BTC price data unavailable$/, he: () => 'נתוני מחיר BTC אינם זמינים' },

  // --- polymarket ---
  { re: /^"(.{1,80})" moved (\+?-?[\d.]+)pp \((bullish|bearish) for BTC\)$/, he: (m) => `"${m[1]}" זז ${m[2]} נק׳ אחוז (${m[3] === 'bullish' ? 'שורי' : 'דובי'} עבור BTC)` },
  { re: /^Polymarket probabilities broadly stable across (\d+) tracked markets$/, he: (m) => `הסתברויות Polymarket יציבות בסך הכול על פני ${m[1]} שווקים במעקב` },
  { re: /^(\d+) Polymarket market\(s\) moving against the aggregate signal$/, he: (m) => `${m[1]} שווקי Polymarket נעים נגד האיתות המצרפי` },
  { re: /^Tracking (\d+) Polymarket markets — building probability history \((\d+)m collected\)$/, he: (m) => `במעקב ${m[1]} שווקי Polymarket — נבנית היסטוריית הסתברויות (${m[2]} דק׳ נאספו)` },
  { re: /^Polymarket change data not yet accumulated for this horizon$/, he: () => 'נתוני שינוי Polymarket טרם נצברו לאופק זה' },
  { re: /^Polymarket (\d+h) momentum limited — only (\d+) minutes of history collected$/, he: (m) => `מומנטום Polymarket ל-${m[1].replace('h', ' שע׳')} מוגבל — נאספו רק ${m[2]} דקות היסטוריה` },
  { re: /^Limited-history signal: Polymarket deltas for this horizon rest on (\d+) minutes of collected snapshots$/, he: (m) => `איתות על היסטוריה חלקית: שינויי Polymarket לאופק זה מבוססים על ${m[1]} דקות של תצפיות` },
  { re: /^Polymarket data unavailable$/, he: () => 'נתוני Polymarket אינם זמינים' },

  // --- etf ---
  { re: /^ETF 5-day net inflows \+\$(\d+)M$/, he: (m) => `זרימות נטו חיוביות ל-ETF ב-5 ימים: ‎+$${m[1]}M` },
  { re: /^ETF 5-day net outflows \$(-?\d+)M$/, he: (m) => `זרימות נטו שליליות מ-ETF ב-5 ימים: ‎$${m[1]}M` },
  { re: /^ETF flows negative — institutional demand weak$/, he: () => 'תזרימי ETF שליליים — ביקוש מוסדי חלש' },
  { re: /^ETF flow data is stale \((?:manual )?source not recently updated\)$/, he: () => 'נתוני תזרימי ETF מיושנים (המקור לא עודכן לאחרונה)' },
  { re: /^ETF flow data unavailable.*$/, he: () => 'נתוני תזרימי ETF אינם זמינים' },
  { re: /^ETF flow file present but contains no usable rows$/, he: () => 'קובץ תזרימי ETF קיים אך אינו מכיל שורות תקינות' },

  // --- macro ---
  { re: /^Dollar index falling \((-?[\d.]+)%\) — supportive for BTC$/, he: (m) => `מדד הדולר יורד (${m[1]}%) — תומך ב-BTC` },
  { re: /^Dollar index rising \(\+([\d.]+)%\) — headwind for BTC$/, he: (m) => `מדד הדולר עולה (‎+${m[1]}%) — רוח נגדית ל-BTC` },
  { re: /^Fed-cut probability at (\d+)% on prediction markets$/, he: (m) => `הסתברות להורדת ריבית הפד: ${m[1]}% בשווקי חיזוי` },
  { re: /^Markets pricing low odds of Fed easing$/, he: () => 'השווקים מתמחרים סיכוי נמוך להקלה מוניטרית של הפד' },
  { re: /^Upcoming: (.+) \((\d{4}-\d{2}-\d{2})\) may reprice markets quickly$/, he: (m) => `בקרוב: ${m[1] === 'FOMC meeting' ? 'ישיבת FOMC' : m[1]} (${m[2]}) — עשוי לתמחר מחדש את השווקים במהירות` },
  { re: /^Macro data unavailable$/, he: () => 'נתוני מאקרו אינם זמינים' },
  { re: /^Macro sources returned no usable values$/, he: () => 'מקורות המאקרו לא החזירו ערכים תקינים' },

  // --- liquidity / session ---
  { re: /^(EU\/US overlap|US session|European session|Asian session) — deep liquidity window$/, he: (m) => `${SESSION_HE[m[1]] ?? m[1]} — חלון נזילות עמוקה` },
  { re: /^(Overnight \(thin liquidity\)|Asian session) — signals during thin hours are less reliable$/, he: (m) => `${SESSION_HE[m[1]] ?? m[1]} — איתותים בשעות דלות נזילות מהימנים פחות` },
  { re: /^BTC trading volume unusually low right now$/, he: () => 'מחזור המסחר ב-BTC נמוך במיוחד כרגע' },

  // --- engine-level ---
  { re: /^No strong directional evidence — signals are mixed or flat$/, he: () => 'אין עדות כיוונית חזקה — האיתותים מעורבים או שטוחים' },
  { re: /^Crypto markets can reprice sharply on unexpected news at any time$/, he: () => 'שוקי הקריפטו עלולים להיתמחר מחדש בחדות על חדשות בלתי צפויות בכל רגע' },

  // --- divergences / alerts ---
  { re: /^BTC down ([\d.]+)% over (\d+)h while Polymarket sentiment shifted bullish \(\+(\d+)\) — possible bullish divergence$/, he: (m) => `BTC ירד ${m[1]}% ב-${m[2]} שע׳ בעוד סנטימנט Polymarket נעשה שורי (‎+${m[3]}) — סטייה שורית אפשרית` },
  { re: /^BTC up ([\d.]+)% over (\d+)h while Polymarket sentiment deteriorated \((-?\d+)\) — possible bearish divergence$/, he: (m) => `BTC עלה ${m[1]}% ב-${m[2]} שע׳ בעוד סנטימנט Polymarket נחלש (${m[3]}) — סטייה דובית אפשרית` },
  { re: /^(\d+h) signal flipped (BULLISH|NEUTRAL|BEARISH) → (BULLISH|NEUTRAL|BEARISH) \(score (-?[\d.]+)\)$/, he: (m) => `איתות ${m[1].replace('h', ' שע׳')} התהפך ${LABEL_HE[m[2]]} ← ${LABEL_HE[m[3]]} (ציון ${m[4]})` },
  { re: /^(\d+h) confidence moved (\d+) → (\d+)$/, he: (m) => `ביטחון ${m[1].replace('h', ' שע׳')} השתנה ${m[2]} ← ${m[3]}` },
  { re: /^"(.{1,70})" moved (\+?-?[\d.]+)pp in 1h$/, he: (m) => `"${m[1]}" זז ${m[2]} נק׳ אחוז בשעה` },
  { re: /^BTC 24h volume spiked (\d+)% vs previous check$/, he: (m) => `מחזור 24 שע׳ של BTC זינק ${m[1]}% לעומת הבדיקה הקודמת` },
];

const SESSION_HE: Record<string, string> = {
  'EU/US overlap': 'חפיפת אירופה/ארה״ב',
  'US session': 'סשן ארה״ב',
  'European session': 'סשן אירופי',
  'Asian session': 'סשן אסייתי',
  'Overnight (thin liquidity)': 'לילה (נזילות דלה)',
};

const LABEL_HE: Record<string, string> = {
  BULLISH: 'שורי',
  NEUTRAL: 'ניטרלי',
  BEARISH: 'דובי',
};

/** Translate one backend-generated explanation string; passthrough when unmatched. */
export function translateDynamic(text: string, lang: Lang): string {
  if (lang !== 'he') return text;
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) return rule.he(m);
  }
  return text;
}

export const DYNAMIC_RULES_COUNT = RULES.length;
