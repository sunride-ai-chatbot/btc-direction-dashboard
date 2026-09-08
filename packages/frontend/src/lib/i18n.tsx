import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'he';

/** English is the canonical key set; Hebrew must cover every key (enforced by tests). */
export const en = {
  // App shell
  'app.subtitle': 'market-signal dashboard',
  'nav.signal': 'Signal',
  'nav.news': 'News',
  'nav.polymarket': 'Polymarket',
  'nav.history': 'History',
  'nav.evaluation': 'Evaluation',
  'nav.health': 'Health',

  // Signal card / dashboard
  'signal.modelConfidence': 'Model confidence',
  'signal.horizonSignal': '{h} signal · score {score}',
  'signal.raw': '(raw: {label})',
  'signal.rawTooltip': 'Hysteresis is smoothing the displayed label',
  'signal.limitedHistory': 'LIMITED HISTORY SIGNAL',
  'signal.updated': 'Updated {ago}',
  'signal.why': 'Why?',
  'signal.risks': 'Risks',
  'label.BULLISH': 'BULLISH',
  'label.NEUTRAL': 'NEUTRAL',
  'label.BEARISH': 'BEARISH',
  'horizon.1h': '1H',
  'horizon.4h': '4H',
  'horizon.24h': '24H',
  'horizon.72h': '72H',
  'dash.divergenceTitle': 'Polymarket / price divergence detected',
  'dash.divergenceNote': 'Informational only — divergences are tracked for performance, they do not move the score yet.',
  'dash.recentAlerts': 'Recent alerts',
  'dash.backendDown': 'Backend not reachable',
  'dash.backendDownHint': 'Start it with {cmd} — retrying automatically.',
  'dash.loading': 'Loading signals…',
  'dash.disclaimer': 'This tool analyzes market signals and does not constitute financial advice.',

  // Components
  'comp.polymarket': 'Polymarket',
  'comp.technical': 'BTC Technicals',
  'comp.etf': 'ETF Flows',
  'comp.macro': 'Macro',
  'comp.liquidity': 'Liquidity / Session',
  'comp.weight': 'weight {pct}%',
  'comp.rawData': 'raw data',
  'comp.hideRawData': 'hide raw data',
  'comp.sourceUnavailable': 'Source unavailable',
  'dir.bullish': '↑ bullish',
  'dir.bearish': '↓ bearish',
  'dir.neutral': '→ neutral',
  'fresh.fresh': 'fresh',
  'fresh.daily': 'daily',
  'fresh.stale': 'stale',
  'fresh.unavailable': 'unavailable',
  'etf.latest': 'Latest',
  'etf.threeDay': '3D',
  'etf.fiveDay': '5D',
  'etf.updated': 'Updated',

  // Polymarket page
  'pm.title': 'Polymarket — BTC-relevant markets',
  'pm.history': '{h}h {m}m of history',
  'pm.csv': 'csv',
  'pm.explainer': 'Sorted by relevance × information value × liquidity. Info = how much usable directional information the market carries (near-resolved contracts score near 0). Moves marked when unusually large (≥3pp/24h).',
  'pm.market': 'Market',
  'pm.prob': 'Prob',
  'pm.d15m': 'Δ15m',
  'pm.d1h': 'Δ1h',
  'pm.d24h': 'Δ24h',
  'pm.volume': 'Volume',
  'pm.liquidity': 'Liquidity',
  'pm.info': 'Info',
  'pm.infoTooltip': 'marketInformationValue 0..1',
  'pm.signal': 'Signal',
  'pm.persistence': 'persistence {pct}%',
  'pm.flat': 'flat',
  'pm.bullish': 'bullish',
  'pm.bearish': 'bearish',
  'pm.empty': 'No relevant markets discovered yet — check back after the next refresh.',
  'pm.loading': 'Loading Polymarket data…',
  'cat.btc-direct': 'BTC-DIRECT',
  'cat.fed': 'FED',
  'cat.inflation': 'INFLATION',
  'cat.macro': 'MACRO',
  'cat.geopolitical': 'GEOPOLITICAL',

  // History page
  'hist.title': 'Signal history',
  'hist.scoreChart': 'Final score (−100 … +100)',
  'hist.priceChart': 'BTC price',
  'hist.confChart': 'Confidence',
  'hist.time': 'Time (IL)',
  'hist.label': 'Label',
  'hist.score': 'Score',
  'hist.conf': 'Conf',
  'hist.topReason': 'Top reason',
  'hist.empty': 'Not enough history yet. Signals are persisted every 5 minutes — leave the backend running.',

  // Evaluation page
  'eval.title': 'Model evaluation',
  'eval.warning': '⚠ Model performance is statistically unreliable until sufficient historical signals have been collected (≥{min} per horizon). Current sample: {n} evaluated signals. Confidence shown everywhere is model confidence, not the probability of BTC rising — this page exists to test whether higher confidence actually corresponds to higher accuracy before any calibration.',
  'eval.empty': 'No signals are old enough to evaluate yet. The evaluator runs automatically every few minutes; 1h signals become evaluable an hour after they are stored (72h signals after three days).',
  'eval.loading': 'Loading evaluation…',
  'eval.overall': 'OVERALL',
  'eval.n': 'n = {n}',
  'eval.unreliable': '· unreliable',
  'eval.directionalAccuracy': 'Directional accuracy',
  'eval.rawAccuracy': '…without hysteresis (raw)',
  'eval.bullishAccuracy': 'Bullish accuracy',
  'eval.bearishAccuracy': 'Bearish accuracy',
  'eval.neutralAccuracy': 'Neutral accuracy',
  'eval.avgReturnBullish': 'Avg return after bullish',
  'eval.avgReturnBearish': 'Avg return after bearish',
  'eval.winRate': 'Win rate by model confidence',
  'eval.confidence': 'Confidence',
  'eval.accuracy': 'Accuracy',
  'eval.avgReturn': 'Avg return',
  'eval.bySession': 'By market session',
  'session.Asia': 'Asia',
  'session.Europe': 'Europe',
  'session.EU/US overlap': 'EU/US overlap',
  'session.US': 'US',
  'session.Overnight': 'Overnight',
  'eval.attribution': 'Component attribution',
  'eval.attributionNote': 'When predictions were correct, which inputs were most useful? Measurement only — weights are not being adjusted from this data{small}.',
  'eval.attributionSmall': ' (sample still too small to act on)',
  'eval.components': 'Signal components',
  'eval.subcategories': 'Polymarket subcategories',
  'eval.input': 'Input',
  'eval.dirAgreement': 'Direction agreement',
  'eval.dirAgreementTooltip': "How often this input's direction matched what BTC actually did",
  'eval.avgScoreCorrect': 'Avg score (correct)',
  'eval.avgScoreWrong': 'Avg score (wrong)',
  'eval.divTitle': 'Polymarket / price divergences',
  'eval.divNote': 'Detected divergence events and what BTC actually did afterwards. These do not move the score yet.',
  'eval.divBullish': '↑ Bullish divergences',
  'eval.divBearish': '↓ Bearish divergences',
  'eval.divStats': '{total} detected · {resolved} resolved · agreement {pct}',

  // Health page
  'health.title': 'System health',
  'health.explainer': 'Missing or stale sources automatically reduce signal confidence. Failure counters reset when the backend restarts (up {ago}).',
  'health.loading': 'Loading system health…',
  'health.provider.polymarket': 'Polymarket',
  'health.provider.btc-price': 'BTC Price',
  'health.provider.macro': 'Macro (FRED)',
  'health.provider.etf': 'ETF Flows',
  'health.provider.cmc-news': 'CMC News',
  'status.LIVE': 'LIVE',
  'status.DAILY': 'DAILY',
  'status.DEGRADED': 'DEGRADED',
  'status.STALE': 'STALE',
  'status.DOWN': 'DOWN',
  'status.UNAVAILABLE': 'UNAVAILABLE',
  'health.lastSuccess': 'Last successful update',
  'health.never': 'never (this process)',
  'health.latency': 'Latency',
  'health.consecutiveFailures': 'Consecutive failures',
  'health.totalFailures': 'Total failures',
  'health.freshness': 'Freshness',
  'health.evaluationsStored': 'Evaluations stored',
  'health.cadence': 'Evaluator cadence',
  'health.everyMin': 'every {m}m',
  'health.neutralBands': 'Neutral bands (1h/4h/24h/72h)',
  'health.export': 'Export raw data:',

  // CMC News intelligence (observational; zero model weight)
  'news.title': 'CMC News intelligence',
  'news.source': 'Public verified @CMC_News feed',
  'news.currentSignal': 'Current news signal',
  'news.trackingOnly': 'TRACKING ONLY · 0% MODEL WEIGHT',
  'news.explainer': 'News is classified for BTC relevance, direction and impact. We measure BTC reaction after 15m / 1h / 4h / 24h before deciding whether it adds predictive value.',
  'news.loading': 'Loading CMC News…',
  'news.unavailable': 'CMC News is temporarily unavailable.',
  'news.btcReaction': 'BTC reaction',
  'news.relevance': 'relevance {n}/100',
  'news.impact.HIGH': 'HIGH IMPACT',
  'news.impact.MEDIUM': 'MEDIUM IMPACT',
  'news.impact.LOW': 'LOW IMPACT',
  'news.category.market': 'Market',
  'news.category.regulation': 'Regulation',
  'news.category.institutional': 'Institutional',
  'news.category.security': 'Security',
  'news.category.macro': 'Macro',
  'news.category.defi': 'DeFi',
  'news.category.other': 'Other',

  // time
  'time.justNow': 'just now',
  'time.secondsAgo': '{n}s ago',
  'time.minutesAgo': '{n}m ago',
  'time.hoursAgo': '{n}h ago',
  'time.daysAgo': '{n}d ago',
} as const;

export type TranslationKey = keyof typeof en;

export const he: Record<TranslationKey, string> = {
  'app.subtitle': 'לוח איתותי שוק',
  'nav.signal': 'איתות',
  'nav.news': 'חדשות',
  'nav.polymarket': 'Polymarket',
  'nav.history': 'היסטוריה',
  'nav.evaluation': 'הערכה',
  'nav.health': 'תקינות',

  'signal.modelConfidence': 'ביטחון המודל',
  'signal.horizonSignal': 'איתות {h} · ציון {score}',
  'signal.raw': '(גולמי: {label})',
  'signal.rawTooltip': 'ההיסטרזיס מחליק את התווית המוצגת',
  'signal.limitedHistory': 'איתות על היסטוריה חלקית',
  'signal.updated': 'עודכן {ago}',
  'signal.why': 'למה?',
  'signal.risks': 'סיכונים',
  'label.BULLISH': 'שורי',
  'label.NEUTRAL': 'ניטרלי',
  'label.BEARISH': 'דובי',
  'horizon.1h': 'שעה',
  'horizon.4h': '4 שע׳',
  'horizon.24h': '24 שע׳',
  'horizon.72h': '72 שע׳',
  'dash.divergenceTitle': 'זוהתה סטייה בין Polymarket למחיר',
  'dash.divergenceNote': 'לידיעה בלבד — סטיות נמדדות לביצועים היסטוריים ואינן משפיעות על הציון בשלב זה.',
  'dash.recentAlerts': 'התראות אחרונות',
  'dash.backendDown': 'אין חיבור לשרת',
  'dash.backendDownHint': 'הפעילו אותו עם {cmd} — ננסה שוב אוטומטית.',
  'dash.loading': 'טוען איתותים…',
  'dash.disclaimer': 'כלי זה מנתח איתותי שוק ואינו מהווה ייעוץ פיננסי.',

  'comp.polymarket': 'Polymarket',
  'comp.technical': 'נתונים טכניים BTC',
  'comp.etf': 'תזרימי ETF',
  'comp.macro': 'מאקרו',
  'comp.liquidity': 'נזילות / סשן',
  'comp.weight': 'משקל {pct}%',
  'comp.rawData': 'נתונים גולמיים',
  'comp.hideRawData': 'הסתרת נתונים',
  'comp.sourceUnavailable': 'המקור אינו זמין',
  'dir.bullish': '↑ שורי',
  'dir.bearish': '↓ דובי',
  'dir.neutral': '→ ניטרלי',
  'fresh.fresh': 'עדכני',
  'fresh.daily': 'יומי',
  'fresh.stale': 'מיושן',
  'fresh.unavailable': 'לא זמין',
  'etf.latest': 'אחרון',
  'etf.threeDay': '3 ימים',
  'etf.fiveDay': '5 ימים',
  'etf.updated': 'עודכן',

  'pm.title': 'Polymarket — שווקים רלוונטיים ל-BTC',
  'pm.history': '{h} שע׳ {m} דק׳ של היסטוריה',
  'pm.csv': 'csv',
  'pm.explainer': 'ממוין לפי רלוונטיות × ערך מידע × נזילות. מידע = כמה מידע כיווני שימושי השוק נושא (חוזים כמעט-מוכרעים מקבלים ערך קרוב ל-0). תנועות חריגות מסומנות (≥3 נק׳ אחוז ב-24 שע׳).',
  'pm.market': 'שוק',
  'pm.prob': 'הסתברות',
  'pm.d15m': 'Δ15ד׳',
  'pm.d1h': 'Δשעה',
  'pm.d24h': 'Δ24ש׳',
  'pm.volume': 'מחזור',
  'pm.liquidity': 'נזילות',
  'pm.info': 'מידע',
  'pm.infoTooltip': 'ערך מידע של השוק 0..1',
  'pm.signal': 'איתות',
  'pm.persistence': 'עקביות {pct}%',
  'pm.flat': 'יציב',
  'pm.bullish': 'שורי',
  'pm.bearish': 'דובי',
  'pm.empty': 'טרם נמצאו שווקים רלוונטיים — בדקו שוב אחרי הרענון הבא.',
  'pm.loading': 'טוען נתוני Polymarket…',
  'cat.btc-direct': 'BTC ישיר',
  'cat.fed': 'פד',
  'cat.inflation': 'אינפלציה',
  'cat.macro': 'מאקרו',
  'cat.geopolitical': 'גאופוליטי',

  'hist.title': 'היסטוריית איתותים',
  'hist.scoreChart': 'ציון סופי (−100 … +100)',
  'hist.priceChart': 'מחיר BTC',
  'hist.confChart': 'ביטחון',
  'hist.time': 'זמן (ישראל)',
  'hist.label': 'תווית',
  'hist.score': 'ציון',
  'hist.conf': 'ביטחון',
  'hist.topReason': 'סיבה עיקרית',
  'hist.empty': 'אין עדיין מספיק היסטוריה. איתותים נשמרים כל 5 דקות — השאירו את השרת פועל.',

  'eval.title': 'הערכת המודל',
  'eval.warning': '⚠ ביצועי המודל אינם מהימנים סטטיסטית עד שנאספים מספיק איתותים היסטוריים (לפחות {min} לכל אופק). המדגם הנוכחי: {n} איתותים שהוערכו. הביטחון המוצג בכל מקום הוא ביטחון המודל, לא ההסתברות ש-BTC יעלה — הדף קיים כדי לבחון האם ביטחון גבוה אכן מתורגם לדיוק גבוה, לפני כל כיול.',
  'eval.empty': 'אין עדיין איתותים ותיקים מספיק להערכה. המעריך רץ אוטומטית כל כמה דקות; איתותי שעה ניתנים להערכה שעה אחרי שמירתם (איתותי 72 שע׳ — אחרי שלושה ימים).',
  'eval.loading': 'טוען הערכה…',
  'eval.overall': 'כולל',
  'eval.n': 'n = {n}',
  'eval.unreliable': '· לא מהימן',
  'eval.directionalAccuracy': 'דיוק כיווני',
  'eval.rawAccuracy': '…ללא היסטרזיס (גולמי)',
  'eval.bullishAccuracy': 'דיוק שורי',
  'eval.bearishAccuracy': 'דיוק דובי',
  'eval.neutralAccuracy': 'דיוק ניטרלי',
  'eval.avgReturnBullish': 'תשואה ממוצעת אחרי איתות שורי',
  'eval.avgReturnBearish': 'תשואה ממוצעת אחרי איתות דובי',
  'eval.winRate': 'אחוזי הצלחה לפי ביטחון המודל',
  'eval.confidence': 'ביטחון',
  'eval.accuracy': 'דיוק',
  'eval.avgReturn': 'תשואה ממוצעת',
  'eval.bySession': 'לפי סשן מסחר',
  'session.Asia': 'אסיה',
  'session.Europe': 'אירופה',
  'session.EU/US overlap': 'חפיפת אירופה/ארה״ב',
  'session.US': 'ארה״ב',
  'session.Overnight': 'לילה (נזילות דלה)',
  'eval.attribution': 'ייחוס רכיבים',
  'eval.attributionNote': 'כשהתחזיות היו נכונות — אילו רכיבים תרמו? מדידה בלבד — המשקולות אינן משתנות מהנתונים האלה{small}.',
  'eval.attributionSmall': ' (המדגם עדיין קטן מכדי לפעול לפיו)',
  'eval.components': 'רכיבי האיתות',
  'eval.subcategories': 'תתי-קטגוריות Polymarket',
  'eval.input': 'רכיב',
  'eval.dirAgreement': 'הסכמה כיוונית',
  'eval.dirAgreementTooltip': 'באיזו תדירות הכיוון של הרכיב תאם את מה ש-BTC עשה בפועל',
  'eval.avgScoreCorrect': 'ציון ממוצע (נכון)',
  'eval.avgScoreWrong': 'ציון ממוצע (שגוי)',
  'eval.divTitle': 'סטיות Polymarket / מחיר',
  'eval.divNote': 'אירועי סטייה שזוהו ומה BTC עשה בפועל אחריהם. אינם משפיעים על הציון בשלב זה.',
  'eval.divBullish': '↑ סטיות שוריות',
  'eval.divBearish': '↓ סטיות דוביות',
  'eval.divStats': '{total} זוהו · {resolved} הוכרעו · הסכמה {pct}',

  'health.title': 'תקינות המערכת',
  'health.explainer': 'מקורות חסרים או מיושנים מפחיתים אוטומטית את ביטחון האיתות. מוני הכשלים מתאפסים בהפעלה מחדש של השרת (פועל {ago}).',
  'health.loading': 'טוען תקינות מערכת…',
  'health.provider.polymarket': 'Polymarket',
  'health.provider.btc-price': 'מחיר BTC',
  'health.provider.macro': 'מאקרו (FRED)',
  'health.provider.etf': 'תזרימי ETF',
  'health.provider.cmc-news': 'חדשות CMC',
  'status.LIVE': 'פעיל',
  'status.DAILY': 'יומי',
  'status.DEGRADED': 'חלקי',
  'status.STALE': 'מיושן',
  'status.DOWN': 'מושבת',
  'status.UNAVAILABLE': 'לא זמין',
  'health.lastSuccess': 'עדכון מוצלח אחרון',
  'health.never': 'אף פעם (בתהליך הנוכחי)',
  'health.latency': 'זמן תגובה',
  'health.consecutiveFailures': 'כשלים רצופים',
  'health.totalFailures': 'סה״כ כשלים',
  'health.freshness': 'טריות',
  'health.evaluationsStored': 'הערכות שמורות',
  'health.cadence': 'תדירות המעריך',
  'health.everyMin': 'כל {m} דק׳',
  'health.neutralBands': 'רצועות ניטרליות (1ש/4ש/24ש/72ש)',
  'health.export': 'ייצוא נתונים גולמיים:',

  'news.title': 'מודיעין חדשות CMC',
  'news.source': 'הפיד הציבורי והמאומת @CMC_News',
  'news.currentSignal': 'איתות החדשות הנוכחי',
  'news.trackingOnly': 'למעקב בלבד · 0% משקל במודל',
  'news.explainer': 'החדשות מסווגות לפי רלוונטיות ל-BTC, כיוון ועוצמת ההשפעה. אנו מודדים את תגובת BTC אחרי 15 דק׳ / שעה / 4 שעות / 24 שעות לפני שנחליט אם יש להן ערך חיזוי.',
  'news.loading': 'טוען חדשות CMC…',
  'news.unavailable': 'חדשות CMC אינן זמינות זמנית.',
  'news.btcReaction': 'תגובת BTC',
  'news.relevance': 'רלוונטיות {n}/100',
  'news.impact.HIGH': 'השפעה גבוהה',
  'news.impact.MEDIUM': 'השפעה בינונית',
  'news.impact.LOW': 'השפעה נמוכה',
  'news.category.market': 'שוק',
  'news.category.regulation': 'רגולציה',
  'news.category.institutional': 'מוסדי',
  'news.category.security': 'אבטחה',
  'news.category.macro': 'מאקרו',
  'news.category.defi': 'DeFi',
  'news.category.other': 'אחר',

  'time.justNow': 'ממש עכשיו',
  'time.secondsAgo': 'לפני {n} שנ׳',
  'time.minutesAgo': 'לפני {n} דק׳',
  'time.hoursAgo': 'לפני {n} שע׳',
  'time.daysAgo': 'לפני {n} ימים',
};

const DICTS: Record<Lang, Record<TranslationKey, string>> = { en, he };

export function translate(lang: Lang, key: TranslationKey, params?: Record<string, string | number>): string {
  let text: string = DICTS[lang][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    // storage unavailable — fall through to browser detection
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('he') ? 'he' : 'en';
}

interface I18nContextValue {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  dir: 'ltr',
  setLang: () => {},
  t: (key, params) => translate('en', key, params),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem('lang', next);
    } catch {
      // storage unavailable — selection still applies for this session
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => translate(lang, key, params),
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, dir: lang === 'he' ? 'rtl' : 'ltr', setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
