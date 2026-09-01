# ₿ Direction — Bitcoin market-direction dashboard

Answers one question: **is Bitcoin more likely to go UP or DOWN in the near term?**

It outputs 🟢 BULLISH / 🟡 NEUTRAL / 🔴 BEARISH per horizon (1h / 4h / 24h / 72h) with a
0–100 confidence score, the top 3 reasons, and the top 2 risks — all derived from real
collected data. It does not predict with certainty and it is not financial advice.

## Installation

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite` — no native compilation).

```bash
npm install
npm run dev        # backend on :8787 + frontend on :5173 (Vite picks next free port)
```

Other commands:

```bash
npm test           # backend unit + integration tests (vitest)
npm run typecheck  # both packages
npm run build      # production build (backend → dist/, frontend → dist/)
npm start          # run the built backend
```

## Environment setup

No API keys are required. Optional overrides (all have sane defaults):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | backend listen address |
| `DB_PATH` | `./data/signals.db` | SQLite file (delete to reset history) |
| `REFRESH_BTC_MS` | `60000` | BTC price/technicals refresh |
| `REFRESH_POLYMARKET_MS` | `300000` | Polymarket refresh |
| `REFRESH_MACRO_MS` | `900000` | macro refresh |
| `REFRESH_ETF_MS` | `3600000` | ETF file re-read |
| `EVAL_JOB_MS` | `300000` | evaluation job cadence |
| `NEUTRAL_PCT_1H/4H/24H/72H` | `0.15/0.35/0.8/1.5` | neutral movement bands (%) for evaluation |
| `ETF_FLOWS_FILE` | `./data/etf-flows.json` | manual ETF flow data (see below) |
| `MACRO_EVENTS_FILE` | `./data/macro-events.json` | editable macro event calendar |
| `POLYMARKET_GAMMA_URL` | gamma-api.polymarket.com | Polymarket API base |
| `BINANCE_API_URL` | api.binance.com | Binance API base |

## Data sources

| Component | Source | Notes |
|---|---|---|
| **Polymarket** (highest weight) | Gamma API (public, keyless) | discovery layer searches active markets by keyword, categorizes (BTC-direct / Fed / inflation / macro / geopolitical), and weights by relevance × log-liquidity. Probability changes are computed from our own stored snapshots. |
| **BTC technicals** | Binance public klines (CoinGecko price-only fallback) | price, 1h/4h/24h change, volume, volatility, RSI-14, EMA 20/50/200, MACD |
| **ETF flows** | manual JSON file | no reliable free real-time API exists. Copy `packages/backend/data/etf-flows.example.json` → `etf-flows.json` and maintain it (e.g. from farside.co.uk/btc). Absent file ⇒ component honestly reports *unavailable* — values are **never fabricated**. |
| **Macro** | FRED public CSV (keyless) | broad trade-weighted dollar index (DTWEXBGS, public stand-in for DXY), 2Y/10Y Treasury yields. Daily series, ~1 business-day lag. Fed-cut odds are derived from Polymarket Fed markets. |
| **Liquidity/session** | computed locally | Israel-time trading-session quality + volume quality. Affects **confidence only**, never direction. |

Every data point carries `source`, `timestamp`, and `freshness` (fresh / stale / unavailable).
A dead provider degrades confidence and is labeled in the UI; it never crashes the engine.

## How scoring works

1. Each component is normalized to **−100 … +100** (see `packages/backend/src/scoring/scorers.ts`).
   - Polymarket: per-market `direction × probability-change`, weighted by relevance × log(liquidity); a 5pp move ≈ ±50. High-liquidity markets dominate.
   - Technicals: momentum (per-horizon window) + RSI + EMA alignment + MACD + volume confirmation.
   - ETF: rolling 3/5-day and previous-day net flows.
   - Macro: dollar-index change (inverse), Fed-cut probability from prediction markets.
2. Final score = weighted sum with **per-horizon weights** (`src/config.ts`, `HORIZON_WEIGHTS`).
   Weights renormalize over available components. 24h default: Polymarket 50%, technicals 20%, ETF 15%, macro 10%, liquidity 5%.
3. Label: ≥ +25 BULLISH · ≤ −25 BEARISH · otherwise NEUTRAL.
4. **Confidence** is computed separately from: signal strength, agreement between independent
   components, provider availability + freshness, and session/volume quality. Clamped to 5–95 —
   the model never claims certainty. It is a *model confidence score*, not a statistical probability.
5. Signals are persisted every 5 minutes with a full reproducibility context (weights used,
   provider freshness, the exact Polymarket markets and deltas that contributed). A scheduled
   evaluator compares each stored signal against the actual BTC price once its horizon elapses,
   using configurable per-horizon neutral bands (±0.15% @1h … ±1.5% @72h) so tiny moves count
   as flat. The **Evaluation** page shows directional/per-label accuracy, win rate by confidence
   bucket (0–49/50–59/60–69/70–79/80+ — to test whether higher confidence ⇒ higher accuracy),
   accuracy by market session, component/subcategory attribution, and divergence performance.
   The displayed label uses hysteresis (no BULLISH→BEARISH flapping); the raw label is stored
   and evaluated alongside it. **Weights and confidence are never auto-tuned from this data** —
   results are flagged unreliable below 50 evaluations per horizon.
6. **Polymarket / price divergences** (price falling while prediction markets turn bullish, or
   vice versa) are detected, displayed, and performance-tracked — but do not move the score.
7. Each market carries a `marketInformationValue` (0–1: probability distance from 0%/100%,
   depth, time to resolution, recent activity) so near-resolved contracts cannot dominate, plus
   15-minute momentum, probability velocity, and path persistence from self-collected snapshots.

Explanations are deterministic templates filled from actual collected data — no LLM is used or
required, and the numeric engine alone decides direction.

## Limitations

- **Probability changes need warm-up**: 1h/4h/24h Polymarket deltas appear only after the app has
  been collecting snapshots that long. Until then the Polymarket component reports "building history".
- **ETF flows are manual** — without the JSON file the component is unavailable (by design).
- **Macro is daily data** with ~1 business-day lag; it will not catch intraday macro shocks.
- **Market-direction inference is heuristic**: markets whose bullish/bearish meaning can't be
  inferred from the title are excluded rather than guessed.
- The model has **not** been fitted to historical data; evaluation exists precisely to measure it
  in the real world first.
- This tool analyzes market signals and **does not constitute financial advice**.
