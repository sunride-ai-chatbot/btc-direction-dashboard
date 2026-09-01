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
