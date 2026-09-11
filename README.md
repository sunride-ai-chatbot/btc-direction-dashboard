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
| `PRICE_STREAM` | `on` | `off` disables the exchange WebSocket stream/SSE |
| `CVD` | `on` | `off` removes the order-flow term from technicals |
| `ADAPTIVE_BAND` / `BAND_K` | `on` / `0.5` | volatility-adaptive neutral band and its σ multiplier |
| `EDGE_GATE` | `on` | `off` shows labels without the "no proven edge" gate |
| `ETF_FLOWS_FILE` | `./data/etf-flows.json` | manual ETF flow data (see below) |
| `MACRO_EVENTS_FILE` | `./data/macro-events.json` | editable macro event calendar |
| `POLYMARKET_GAMMA_URL` | gamma-api.polymarket.com | Polymarket API base |
| `BINANCE_API_URL` / `KRAKEN_API_URL` / `COINBASE_API_URL` | official bases | spot candle sources |
| `CANDLE_SOURCES` | `binance,kraken,coinbase` | candle venues tried in order (Binance is geo-blocked from some hosts) |
| `CANDLE_HISTORY_HOURS` | `72` | one-time boot backfill of 1-minute history for the live chart |
| `DERIVATIVES` / `REFRESH_DERIVATIVES_MS` | `on` / `120000` | funding / OI / liquidation tracking (zero model weight) |

## Data sources

| Component | Source | Notes |
|---|---|---|
| **Polymarket** (highest weight) | Gamma API (public, keyless) | discovery layer searches active markets by keyword, categorizes (BTC-direct / Fed / inflation / macro / geopolitical), and weights by relevance × log-liquidity. Probability changes are computed from our own stored snapshots. |
| **BTC technicals** | hourly candles from the first venue that answers — Binance → Kraken → Coinbase (CoinGecko price-only as a last resort) | price, 1h/4h/24h change, volume, volatility, RSI-14, EMA 20/50/200, MACD; `source` records the venue used |
| **ETF flows** | manual JSON file | no reliable free real-time API exists. Copy `packages/backend/data/etf-flows.example.json` → `etf-flows.json` and maintain it (e.g. from farside.co.uk/btc). Absent file ⇒ component honestly reports *unavailable* — values are **never fabricated**. |
| **Macro** | FRED public CSV (keyless) | broad trade-weighted dollar index (DTWEXBGS, public stand-in for DXY), 2Y/10Y Treasury yields. Daily series, ~1 business-day lag. Fed-cut odds are derived from Polymarket Fed markets. |
| **Liquidity/session** | computed locally | Israel-time trading-session quality + volume quality. Affects **confidence only**, never direction. |
| **Derivatives** (tracking only, 0% weight) | Kraken Futures, Deribit, BitMEX, Bybit, OKX public endpoints | funding normalized to 8h (venue median), open interest per venue + 24h change from our own history, OKX liquidations (1h window). Own table / `/api/derivatives` / CSV / page — never enters the score. |

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
8. **Live consensus price**: Binance/Coinbase/Kraken WebSockets feed a median consensus price
   (streamed to the UI over SSE at `/api/stream`); a >0.5% cross-exchange spread flags a PRICE
   ANOMALY and lowers confidence. Every venue's live trades are pooled into our own 1-minute
   candles (with the real taker buy/sell split), persisted in `btc_candles_1m`, and drive an
   order-flow (CVD) term inside the technical component — so order flow keeps working wherever
   at least one exchange feed is reachable. A REST backfill (any venue) fills price gaps but
   never overwrites a candle that already knows its taker split.
9. **Honest edge**: every evaluation stores the neutral band that judged it (`fixed-v1` legacy or
   `vol-adaptive-v2` = 0.5×realized σ of the horizon) and the market regime. The edge measure is
   score-sign agreement on non-flat outcomes with 95% Wilson bounds; a horizon shows a
   directional label as actionable only when its lower bound exceeds 55% on n ≥ 100 — otherwise
   the card says **NO PROVEN EDGE** and shows the model lean. `/api/reliability` reports edge
   (7d / all-time), by-regime breakdown, score distribution, band info, conformal coverage and a
   CUSUM drift alarm.
10. **Conformal ranges**: split-conformal 80%/50% intervals for the horizon move are attached to
    each signal, plus the empirical up-rate of similar past score states (with n).

Explanations are deterministic templates filled from actual collected data — no LLM is used or
required, and the numeric engine alone decides direction.

## Railway deployment (production)

The backend runs 24/7 as a Railway service with the SQLite database on a persistent volume.

**Live service**: `https://btc-backend-production-f698.up.railway.app` (project `btc-direction-dashboard`, service `btc-backend`).

### Architecture
- Docker build (`Dockerfile`, node:26-slim, multi-stage; backend only).
- Persistent volume `btc-backend-volume` mounted at **`/data`**; the DB lives at
  **`/data/bitcoin-dashboard.sqlite`** via `DATABASE_PATH`. Never store the production DB in the
  container filesystem — it would vanish on every deploy.
- `railway.json`: health check `/health`, restart policy ALWAYS, 1 replica (the scheduler assumes
  a single instance — do not scale horizontally).
- The server binds `process.env.PORT` (Railway-injected) and `0.0.0.0` when `RAILWAY_ENVIRONMENT`
  is present; local dev stays `127.0.0.1:8787`.

### Environment variables (Railway)
| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_PATH` | `/data/bitcoin-dashboard.sqlite` | SQLite on the persistent volume |
| `NODE_ENV` | `production` | |
| `CORS_ORIGIN` | *(optional)* | comma-separated allowed origins; unset = allow all (read-only API) |
| `IMPORT_TOKEN` | *(unset)* | set ONLY for a one-time DB import, remove afterwards |

### Deploying updates
```bash
railway link          # once per checkout: project btc-direction-dashboard, service btc-backend
railway up --detach   # build + deploy current directory
railway logs          # runtime logs
```

### Verifying health
`GET /health` returns status, uptime, DB path + row counts, scheduler state, last BTC/Polymarket/
evaluator activity, and provider statuses; it is also Railway's health check (503 until the
scheduler is up or if SQLite fails).

### Restarting safely
`railway redeploy -y` — SIGTERM triggers a graceful shutdown (schedulers stopped, DB closed);
the volume preserves all data. Verified: restarts and redeploys do not lose rows.

### Backup / restore
- **Backup**: `sqlite3` not required — the API's CSV exports cover analysis; for a full binary
  backup run locally `node -e "…backupTo(…)"` or copy `/data/bitcoin-dashboard.sqlite` via
  `railway ssh` (VACUUM'd snapshots preferred; `SignalDatabase.backupTo()` wraps `VACUUM INTO`).
- **Restore / import**: set `IMPORT_TOKEN` on the service, redeploy, then
  `curl -X POST $URL/api/admin/import-db -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" --data-binary @snapshot.db`,
  then `railway redeploy -y` and **delete `IMPORT_TOKEN`**. The endpoint 404s while the token is
  unset. Local history was migrated this way on 2026-09-01 (156 signals / 35 evaluations /
  485 snapshots at migration time); the pre-migration local DB and a `signals-backup-*.db`
  snapshot remain untouched in `packages/backend/data/`.

### Frontend against production
```bash
VITE_API_BASE_URL=https://btc-backend-production-f698.up.railway.app npm run dev -w frontend
# or bake it into a static build:
VITE_API_BASE_URL=https://btc-backend-production-f698.up.railway.app npm run build -w frontend
```
Unset, the frontend uses the local Vite proxy → `127.0.0.1:8787` as before.

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
