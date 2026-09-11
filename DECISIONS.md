# Decisions & assumptions

Key judgment calls made while building the MVP, so they can be revisited deliberately.

## Data & providers

1. **`node:sqlite` instead of better-sqlite3** — this machine has no C toolchain (no Xcode), and
   Node ≥ 22.5 ships SQLite built in. Zero native deps; same synchronous API shape. Migration to
   PostgreSQL stays easy because all SQL lives in `db/database.ts` behind one class.
2. **Stooq was dropped for macro** — it now sits behind a JavaScript proof-of-work challenge, so it
   is not programmatically usable (and we do not bypass bot checks). Replaced with FRED's public
   CSV export (keyless, official). Consequence: daily series with ~1 business-day lag, and the
   dollar gauge is the Fed broad dollar index (DTWEXBGS), not ICE DXY. Direction of both indexes
   correlates strongly, which is what the scorer uses.
3. **Fed-rate expectations come from Polymarket, not a rates API** — free FedWatch-style data needs
   scraping. We already track Fed markets on Polymarket, so the pipeline injects a
   liquidity-weighted "Fed cut" probability into the macro component. Single source of truth,
   honestly labeled.
4. **ETF flows are manual-file only** — every real-time flow API found is paid or scraping-based.
   The provider interface (`EtfProvider`) exists so a real API can be dropped in later. Missing
   file ⇒ `available: false` ⇒ weight renormalized away and confidence penalized. Never fabricated.
5. **Polymarket probability history is self-collected** — the Gamma API doesn't serve historical
   prices cheaply. We snapshot every 5 min into SQLite and compute 1h/4h/24h deltas from our own
   rows (nearest snapshot within tolerance). First hours after install therefore show "building
   probability history" — honest cold start rather than fake deltas.

## Scoring

6. **Direction score comes from probability *changes*, not levels** — "BTC > $100k at 42%" says
   nothing directional by itself; the *move* from 35% → 42% does. Level is used only for the
   derived Fed-cut probability.
7. **Bullish/bearish direction per market is inferred from title heuristics**
   (`bullishDirection()` in `providers/polymarket.ts`). Markets whose direction can't be inferred
   are **excluded**, not guessed. Near-resolved markets (<3% or >97%) are excluded as
   informationless.
8. **Scale: 5pp move ≈ ±50 score** in a market's contribution, clamped ±100. Chosen so that a
   noticeable repricing in a liquid market produces a strong but not saturating signal.
9. **Liquidity/session contributes 0 to direction** — the spec includes it in the weighted formula
   (5%) but also says time-of-day must only modify confidence. Resolution: the component's
   direction score is always 0 (so the 5% weight contributes nothing directionally) and
   session/volume quality multiply confidence (×0.75–1.0). Both spec statements hold.
10. **Weights renormalize over available components** — if ETF (15%) is down, the remaining 85%
    scales up to 100% so a dead provider doesn't silently drag scores toward neutral; the penalty
    for missing data is applied to *confidence* instead (−8 per unavailable, −4 per stale source).
11. **Confidence is clamped to 5–95** and displayed as an integer — never 0/100, no fake decimal
    precision ("confidence 68%", never "68.42% chance of going up").
12. **Per-horizon weights** (`config.ts`): 1h leans technical/momentum (40% tech, 15% liquidity),
    72h leans Polymarket/macro/ETF (50/15/20). The 24h row matches the spec's suggested weights
    exactly.
13. **Signal persistence every 5 min** (not every 1-min compute) — keeps history dense enough for
    evaluation without bloating SQLite; compute still refreshes the UI every minute.

## Evaluation

14. **"Correct" definition**: BULLISH ⇢ price rose at all; BEARISH ⇢ fell at all; NEUTRAL ⇢ move
    stayed inside a per-horizon flat band (±0.3% @1h, ±0.6% @4h, ±1.5% @24h, ±2.5% @72h). The
    bands are config constants in `scoring/evaluation.ts`.
15. **Future price lookup tolerance** is 10 min or 10% of the horizon (whichever is larger),
    using our own stored BTC price rows.
16. **No fitting to history yet** — per spec, evaluation only measures; nothing feeds back into
    weights.

## Product

17. **FOMC dates ship as an editable JSON** (`data/macro-events.json`) — scheduled-event calendars
    change; a config file the user can verify beats a hardcoded list. Dates should be checked
    against federalreserve.gov.
18. **Alert sinks are pluggable** (`AlertSink` interface): MVP writes to SQLite + shows in-app;
    Telegram/email/push can be added by implementing one method. Alerts dedupe within 1h.
19. **No LLM anywhere** — explanations are deterministic templates filled with collected values,
    per the "must work without an AI key" requirement.

# Phase 2 — validation & calibration (2026-09-01)

## Persistence & evaluation

20. **Schema is now versioned** via `PRAGMA user_version` (v2). Migrations run automatically on
    startup; the Phase 1 DB migrated in place with zero row loss. `signals` gained `raw_label`
    and `context_json` — the context stores applied+configured weights, provider freshness,
    unavailable providers, session, the exact Polymarket markets used (with the pp-change and
    information value each contributed), technical/macro/ETF values. A signal is reproducible
    from its row alone.
21. **Evaluation is a scheduled job** (every 5 min, `EVAL_JOB_MS`), not an on-demand report:
    outcomes are written once to an `evaluations` table (UNIQUE per signal). Future prices come
    only from our own stored `btc_price_history`; if no price exists within tolerance
    (max(10 min, 10% of horizon)) the signal is skipped permanently rather than approximated.
22. **Neutral movement bands are config** (`NEUTRAL_THRESHOLD_PCT`, env-overridable):
    ±0.15% @1h, ±0.35% @4h, ±0.8% @24h, ±1.5% @72h. A +0.08% drift validates nothing. These are
    tighter than the Phase-1 report bands because they now define *correctness*, not display.
23. **Confidence buckets changed** to the spec's 0–49 / 50–59 / 60–69 / 70–79 / 80+ and each
    bucket reports avg confidence next to realized accuracy so calibration error is measurable.
    Confidence itself is untouched (measure first); the UI labels it MODEL CONFIDENCE.
24. **Reliability floor**: results are flagged "statistically unreliable" below 50 evaluated
    signals per horizon (`MIN_RELIABLE_SAMPLES`). The warning is always shown with the sample size.
25. **Sessions are derived, stored, measured**: UTC timestamps are stored; the Israel-local
    session (Asia / Europe / EU-US overlap / US / Overnight) is computed DST-correctly at
    evaluation time and saved per evaluation. No assumption that any session is better — the
    evaluation page reports measured accuracy per session.

## Signal quality

26. **marketInformationValue (0..1)** multiplies each market's weight:
    `extremeness^0.6 × depth × timeToResolution × recentActivity`, where extremeness = 4p(1−p)
    (peaks at 50/50, collapses near 0%/100%). The hard parse cutoff was widened to 1.5%/98.5%
    since grading now handles near-resolved contracts. A 99.8% market can no longer dominate.
27. **Momentum & persistence** come from our own snapshot series: 15-minute delta, pp/hour
    velocity over the last hour, and persistence = |net move| / path length (42→43→45→50 ≈ 1.0,
    42→50→43 ≈ 0.07). Persistence scales market weight by 0.7–1.0 — smooth drifts count more
    than spike-and-revert. Deliberately simple; no curve fitting.
28. **Cold start is explicit**: snapshots carry `historyMinutes`; a horizon whose delta window
    exceeds collected history marks the signal LIMITED HISTORY with the exact minutes collected.
    Missing deltas are skipped, never treated as zero. 1h signals may fall back to the real
    15-minute observation (labeled, not extrapolated).
29. **Hysteresis** (`stabilizeLabel`): leaving a directional label requires crossing
    threshold − 7; a direct BULLISH↔BEARISH flip requires |score| ≥ 45, otherwise the path is
    BULLISH → NEUTRAL → BEARISH. Both labels persist (`label` stabilized, `raw_label` raw) and
    both correctness values are evaluated, so hysteresis can be judged with data later.
    Hysteresis state survives restarts (bootstrapped from the last stored labels).
30. **Divergence detection** compares BTC's 4h move against the info-value-weighted Polymarket
    4h shift (thresholds: ≥0.6% price move against ≥8 poly score, 2h dedup). Events are stored,
    alerted, and shown, and the evaluation page tracks what BTC did 4h/24h afterwards — they do
    NOT enter the score. Attribution/agreement stats decide their future, not intuition.

## Measurement-only guardrails

31. **Component attribution measures, never tunes**: per component and per Polymarket
    subcategory it reports direction-agreement rate and average score in correct vs incorrect
    predictions. Weights stay fixed until a statistically meaningful sample exists
    (≥50 evaluations/horizon, ideally weeks of data across market regimes).
32. **Provider health counters are in-process** (reset on restart, shown with process uptime).
    Last-successful-update survives implicitly in the stored data; adding a health table was
    judged not worth the write load for an MVP validation phase.
33. **CSV exports** (`/api/export/{signals,evaluations,polymarket_snapshots}.csv`) exist so the
    model can be analyzed externally (pandas/sheets) without touching the SQLite file.

# Phase 3 — Railway deployment (2026-09-01)

34. **SQLite on a Railway persistent volume, not PostgreSQL.** The workload is one small writer
    (a few rows/minute), one service instance, and we must carry the existing SQLite history
    forward unchanged. A volume-backed `/data/bitcoin-dashboard.sqlite` gives durability across
    deploys/restarts with zero migration risk. PostgreSQL is the documented FUTURE option — it
    becomes necessary only if we add horizontal scaling, concurrent writers, or want managed
    backups; all SQL already lives behind `SignalDatabase`, so the swap stays contained.
35. **Single-instance scheduler assumption.** Signal generation, evaluation, and alert dedup all
    assume exactly one process (railway.json pins `numReplicas: 1`). Scaling replicas without
    moving schedulers to a leader-elected/queued design would double-write history.
36. **`DATABASE_PATH` env decides the DB location** (local default `./data/signals.db` unchanged;
    `DB_PATH` kept as a legacy alias). Host binds `0.0.0.0` only when `RAILWAY_ENVIRONMENT` is
    present; the port always honors `process.env.PORT` (Railway injects it; local default 8787).
37. **History migration used a token-guarded one-time import endpoint**
    (`POST /api/admin/import-db`, active only while `IMPORT_TOKEN` is set, constant-time compare,
    SQLite magic-byte check, atomic tmp-file rename, WAL sidecars cleared, then process exit for
    a clean reopen). Chosen over `railway ssh` streaming for verifiability: the response reports
    the replaced row counts, and post-restart counts were compared against the local snapshot.
    The token was deleted after migration — the endpoint now 404s. The source snapshot came from
    `VACUUM INTO` (consistent under WAL); the pre-migration local DB and the snapshot both remain
    on disk untouched.
38. **Clean exit does not auto-restart on Railway** (restart policy reacts to crashes/health
    failures). The import flow therefore ends with an explicit `railway redeploy` — which doubled
    as the redeploy-persistence test.
39. **railway.json config-as-code is deprecated by Railway** (supported until 2026-12-01) in
    favor of `.railway/railway.ts` IaC. Kept railway.json for now; migrating to IaC is a small
    future task (`railway config migrate --apply`).
40. **CORS stays permissive** (`origin: true`) while no fixed frontend origin exists: the API is
    read-only apart from alert-ack; the import endpoint is disabled. `CORS_ORIGIN` env can
    restrict it the moment the frontend gets a stable production URL.
41. **Frontend deployment deferred** (per instruction to prioritize the backend). The frontend
    reads `VITE_API_BASE_URL` and was verified (desktop + mobile) against the Railway backend;
    deploying it as a static site is a follow-up.

# Phase 4 — real ETF flows + Hebrew/English UI (2026-09-01)

42. **ETF source: SoSoValue open API** (`POST /openapi/v2/etf/historicalInflowChart`,
    `type: us-btc-spot`) — a reputable ETF-data aggregator with a keyless machine-readable JSON
    endpoint returning ~300 trading days of aggregate US spot-BTC ETF daily net flows. Preferred
    over Farside (now behind a bot wall → brittle scraping) and CoinGlass/API-key services.
    Aggregate-only: the endpoint does not break down per fund (IBIT/FBTC/…), which the scoring
    engine does not need; per-fund collection is a possible follow-up. Override:
    `ETF_SOURCE=manual` falls back to the legacy manual-file provider.
43. **ETF COMPONENT TRANSITION**: unavailable → ACTIVE with the deploy at
    **2026-09-01 ~18:2x UTC** (see the deploy commit for this phase). Every stored signal's
    `context_json.unavailableProviders` records per-signal whether ETF participated, so
    historical evaluation remains exactly reproducible across the transition. The ETF weight
    and `scoreEtf()` math are byte-identical to Phase 1 — only real data now flows in.
44. **ETF freshness semantics**: trading-day data ≤5 calendar days old ⇒ `fresh`, surfaced as
    **DAILY** (never LIVE — schema v4 of `statusOf()` maps daily-cadence fresh→DAILY,
    stale→STALE). On source failure the provider serves the last-known rows from the new
    `etf_flow_history` table (schema v3, additive) marked STALE for up to 14 days, then
    UNAVAILABLE. Zeros are never fabricated.
45. **Self-collected ETF dataset**: every successful fetch upserts per-date rows into
    `etf_flow_history` (date-keyed), building our own history independent of the source's
    retention and powering the stale fallback.
46. **i18n via a typed dictionary, not react-i18next** — ~180 UI strings across two locales in
    one typed module (`lib/i18n.tsx`); compile-time key checking and a parity unit test beat a
    runtime framework at this size. Language state: localStorage (`lang`) → browser-language
    detection fallback; switching flips `<html dir/lang>` instantly, no reload.
47. **Dynamic explanations translate by template pattern-matching** (`lib/dynamicHe.ts`):
    the backend keeps emitting canonical English template strings (stored history is never
    rewritten or machine-translated); the frontend matches each known template with a regex and
    renders Hebrew with the captured numbers/titles. Chosen over structured
    explanation-keys-in-DB because it required zero backend/schema changes mid-collection and
    is 100% backward compatible — unknown/legacy strings pass through unchanged. A coverage
    test pins every backend template to a Hebrew rendering; new templates must be added to both
    files (enforced culturally + by test samples).
48. **RTL strategy**: `dir=rtl` on the root + two CSS rules — physical `text-left/right`
    utilities mirror under `[dir="rtl"]`, and `.font-mono` cells stay LTR (`unicode-bidi:
    isolate`) so prices/percentages/tickers render correctly. Charts sit in `.chart-ltr`
    wrappers: chronology and axes are never mirrored. Language affects rendering only — the
    numerical signal path has no locale input.

# Phase 5 — reliability: live consensus price, honest edge, conformal ranges (2026-09-08)

## What the first week of data said (drove every decision below)

49. **Finding**: 7,319 evaluations (Sep 1–8) showed the composite score never crossed ±25 at
    1h/4h (0 directional calls), the "61% accuracy" at 4h was purely the neutral-band artifact
    (61% of 4h moves are < ±0.35%), and score-sign agreement on non-flat outcomes was
    23% (4h), 0/410 (24h) and 16% (72h) — inverse in one trending week. Conclusion: no proven
    directional edge yet; any "certainty" presentation would have been dishonest. Phase 5
    therefore builds the machinery that can prove (or disprove) edge instead of asserting it.

## Live price & data quality

50. **Multi-exchange WebSocket consensus** (Binance trade + kline_1m, Coinbase ticker, Kraken
    ticker; global `WebSocket`, no dependency). Consensus = median of exchanges with a tick
    ≤15s old; a spread or single-exchange deviation > 0.5% flags a PRICE ANOMALY that is
    stored per signal and costs 8 confidence points. The consensus replaces the REST price
    for `btcPrice` and for `btc_price_history` (the evaluator's truth source); indicators still
    come from the REST hourly klines. Exponential-backoff reconnects (2s→60s).
51. **SSE (`/api/stream`)**, throttled to 2 frames/s, pushes ticks + a `signal` event on each
    recompute. Chosen over WebSockets for the browser because it is one-directional, proxy-
    friendly on Railway, and `EventSource` reconnects on its own. The frontend falls back to
    the polled price and labels it POLLING when the stream is not fresh.
52. **1-minute candles + CVD**: closed Binance klines (taker-buy volume, field `V`/index 9) are
    persisted in `btc_candles_1m` (schema v5) and backfilled from REST on startup (299 candles,
    excluding the open minute). CVD ratio = (buy−sell)/(buy+sell) per 15m/1h/4h window enters
    the *technical composite* with an internal weight of 0.25 (1h/4h), 0.1 (24h), 0 (72h)
    — component weights unchanged; every value is stored in `technicalValues` for attribution.

## Honest evaluation

53. **Volatility-adaptive neutral band (evaluation v2)**: band = 0.5 × σ_h, where σ_h is the
    realized 1-minute σ over the trailing 7 days scaled by √(horizon minutes), clamped to
    [0.5×, 3×] the legacy fixed band. k = 0.5 reproduces the fixed bands at typical BTC vol
    (≈0.35% at 4h) and adapts in calm/violent regimes. **Every evaluation row stores
    `band_pct` + `band_method`** (`fixed-v1` for all pre-Phase-5 rows, backfilled in the
    migration) so the two regimes are never mixed silently; the reliability report shows the
    v2 share per horizon.
54. **Regime provenance**: each evaluation stores the regime (trend-up / trend-down / range /
    high-vol / unknown) derived from the technical values stored *at signal time*; legacy rows
    were backfilled from their `context_json`. Reports break edge down by regime — measured,
    not assumed.
55. **The edge measure is score-sign agreement**, not label accuracy: among non-flat outcomes
    where |score| ≥ 5, did sign(score) match the realized direction? Baseline 50%, evaluated
    with 95% Wilson bounds over the last 7 days (fallback: all-time in the report). This uses
    all 7k evaluations instead of the near-zero set of ±25 crossings, and a neutral-band
    artifact cannot inflate it.
56. **"NO PROVEN EDGE" gate**: a horizon's label is presented as actionable only when its
    Wilson lower bound > 55% on n ≥ 100. Otherwise the card shows NO PROVEN EDGE with the
    model's lean (label + score) shown small. `inverse` (upper bound < 45%) is displayed
    but NOT acted on — one anti-correlated week is not a fade signal. The gate changes
    **presentation only**: label, raw label, score and context are computed, stored and
    evaluated exactly as before, so edge can be proven from the same data later. Status
    transitions raise `edge-status` alerts.
57. **Split conformal intervals**: per horizon, the older half of the last ≤2000 evaluations
    fits center = a + β·score (least squares), the newer half calibrates |residual|
    quantiles with the finite-sample (n+1) correction; 80% and 50% intervals are attached to
    every live signal and stored in its context. The report shows realized coverage over the
    last 200 rows (should ≈ 80%) and the score-free baseline half-width, so we can see whether
    the score narrows the range at all. Coverage holds under exchangeability regardless of β.
58. **Similar past states**: empirical up-rate (Wilson CI) among last-7-day non-flat outcomes
    in the same score bucket (≤−25, −25..−10, −10..−3, −3..3, 3..10, 10..25, ≥25). Shown only
    with n; never as a probability claim.
59. **Drift control chart**: daily sign-agreement series with Wilson bands, plus a Bernoulli
    CUSUM (reference 0.5, k = 0.05, h = 8) that raises a `model-drift` alert when agreement runs
    persistently below 50%. Weights and confidence remain untouched by all of this — Phase 5
    measures; Phase 6 (ensemble / shadow model) may act on it once edge exists.

## Data foundation (Phase 6a — make the inputs real before touching the model)

60. **Exchange-agnostic candles (supersedes the Binance-only parts of #50/#52)**: Binance is
    geo-blocked (HTTP 451) from Railway's US region, which had silently left production without
    RSI/EMA/MACD (the CoinGecko price-only fallback) and without any order flow at all. Hourly
    technicals and the 1-minute backfill now come from the first venue that answers in
    `CANDLE_SOURCES` (Binance → Kraken → Coinbase, `providers/candles.ts`), each given ONE fast
    attempt so fail-over takes seconds, not retry backoffs. `BitcoinTechnicals.source` records
    which venue produced the numbers. Kraken/Coinbase REST candles carry no taker split, so
    `Candle1m.takerBuyVolume` became nullable (DB v6 rebuilds the table inside one transaction —
    SQLite cannot relax NOT NULL in place). Coinbase rows are `[time, low, high, open, close, vol]`
    (not OHLC order) and a candle only counts as closed once its whole interval is in the past.
61. **Order flow from pooled live trades, not one venue's kline stream**: every connected
    exchange's trade feed (Binance `@trade` maker flag, Coinbase `matches` where `side` is the
    MAKER side, Kraken `trade` where the side is the TAKER's) is bucketed into our own 1-minute
    candles (`TradeCandleBuilder`, 3 s grace so a late trade from a slower venue lands in its
    own minute). CVD therefore works wherever at least one trade feed is up. Candles without a
    split are excluded from CVD rather than counted as a fabricated 50/50, and a split-less
    backfill candle never overwrites one that has a split (`preferCandle`, mirrored in the SQL
    upsert `WHERE`). Basis rule: a candle's buy volume and total volume always come from the
    same trades, so the ratio stays meaningful even though venues are pooled.
62. **Derivatives positioning is tracking-only — the CMC-news contract, verbatim**: funding /
    open interest / liquidations from Kraken Futures, Deribit, BitMEX, Bybit and OKX are fetched
    in parallel (`Promise.allSettled`; any subset suffices, the unreachable ones are named in
    `source`). Funding is normalized to 8 hours before venues are compared — Kraken Futures
    publishes an ABSOLUTE hourly amount in quote currency (÷ mark price × 8), the others are
    already 8h fractions — and aggregated as the venue MEDIAN so one venue cannot move it. OI is
    summed only across the venues that answered, and its 24h change compares each venue against
    OUR OWN reading ~24h earlier (null until that history exists — never a fake 0). Zero model
    weight, own table (`derivatives_history`, pruned with the other time series), own route
    (`/api/derivatives`), CSV and page. It must not enter `HORIZON_WEIGHTS` / `ComponentSet`
    until an evaluation shows it carries information about realized moves. The positioning
    thresholds (≥ 0.03% / 8h long-crowded, ≤ −0.01% short-crowded, ~0.01% neutral) are a
    crowdedness read, explicitly not a direction call.
63. **Liquidations only where the venue timestamps them**: OKX's `liquidation-orders` carries a
    per-order `ts`, so a 1-hour window is honest (USD = contracts × 0.01 BTC × bankruptcy price).
    BitMEX's `/liquidation` rows have no timestamp and are therefore not used at all.
64. **Deep candle history is paged once at boot** (`fetchCandleHistory`, `CANDLE_HISTORY_HOURS`
    = 72): Kraken returns ≤720 rows per call from `since`, Binance ≤1000 from `startTime`,
    Coinbase ≤300 from `start/end`, so history is walked oldest → newest and de-duplicated. It
    runs off the critical path (after the first signal) and can never overwrite a candle that
    already carries a taker split. Without it a fresh deploy's chart would show only the
    minutes accrued since boot.

## Front end (v3 — terminal shell)

65. **The live chart is TradingView's `lightweight-charts` (v5)**, not Recharts: canvas
    rendering, crosshair, panes, time-scale scrolling — the one thing a trading UI cannot fake
    with an SVG line. It is code-split (`LiveChart` chunk) so pages without it stay light.
    Candles are aggregated client-side from the 1-minute series (1m / 5m / 15m / 30m by
    horizon); the last bar is rebuilt live from SSE ticks between refreshes.
66. **The conformal interval is drawn as a √t cone from "now" to the horizon**: the interval is
    calibrated for the horizon endpoint, so the band width scales with √(t/H) (diffusion) and
    the center (a + β·score) linearly (drift) — a flat tube would overstate near-term
    uncertainty and understate the far end. Drawn as five stacked area series (two tints, two
    background masks) so the 80% and 50% bands nest without a custom renderer; the chart has an
    opaque background for that reason. Gated horizons draw it in neutral gray.
67. **Volume bars are colored by taker buy share, not by candle direction** — that is the
    order-flow story the pooled trade streams make possible (green ≥55%, red ≤45%, gray
    otherwise, faint gray when the minute has no split). EMA overlays use a palette validated
    by the dataviz checker for CVD separation on the dark surface (`#0284c7/#b45309/#7c3aed`),
    deliberately distinct from the reserved bull/bear colors.
68. **One SSE connection per page** (`LiveProvider`): the ticker bar, chart, order-flow panel and
    signal HUD all read the same stream. The ticker lists only exchanges that are actually
    delivering a fresh price, so a geo-blocked venue simply does not appear.
69. **"Model confidence" is explained in-product** (info tooltip on the HUD): it is the model's
    self-agreement/data-quality score (30 + strength + component agreement − missing/stale
    sources, scaled by session quality), explicitly not P(up) — the Evaluation page exists to
    test whether it tracks accuracy.
