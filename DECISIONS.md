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
