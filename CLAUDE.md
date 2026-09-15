# CLAUDE.md

Orientation for working on this repo. **`DECISIONS.md` is the authoritative record** — 90+
numbered entries with the reasoning behind every non-obvious choice. Read the entries
relevant to what you are touching before changing it, especially anything in scoring.

## What this is

A Bitcoin market-direction dashboard. It answers one question — is BTC more likely to go up
or down over 1h / 4h / 24h / 72h — and it is built to be **honest about not knowing**. The
hardest constraint in the project is that it must never present a number as more meaningful
than the data behind it.

npm workspaces monorepo:
- `packages/backend` — Fastify, `node:sqlite` (NOT better-sqlite3; this Mac has no C toolchain)
- `packages/frontend` — React 18 + Vite + Tailwind, Hebrew/English with RTL

## Invariants — breaking these is a bug even if tests pass

**The database is irreplaceable.** Signals and evaluations accumulate in real time from
inputs no API serves retroactively. Never reset, never migrate without a verified backup,
never prune signals or evaluations.

**A missing input is not a neutral input.** A component that cannot compute anything must
return `available: false`, which redistributes its weight and docks confidence. Returning
`score: 0, available: true` keeps full weight while contributing nothing — that was a real
bug (DECISIONS #82).

**Rows from different scoring epochs must never be pooled.** Change scoring semantics ⇒ bump
`SCORING_VERSION` in `scoring/version.ts` and add an epoch entry. Otherwise new rows silently
mix with old ones and every accuracy figure becomes a blend of two models (#79–84).

**Statistics are counted in independent samples.** Signals persist every ~5 minutes, so
stored rows overlap heavily; 93 rows at 4h were 2 non-overlapping observations. Thin with
`thinToNonOverlapping` before trusting any per-horizon number (#83).

**Keyword and direction heuristics are whole-word and order-sensitive.** A substring match
(`"incr`**`ease`**`"` matching `/ease/`) inverted the highest-weight input for two weeks
(#72–74). Also: "is this an X market" must never be inferred from "is rising YES bullish".

**Migrations are one transaction — DDL, backfill and the `user_version` bump together.** A
mid-deploy SIGTERM must leave the schema untouched so the next boot retries cleanly. Follow
the v5/v6/v7 pattern in `db/database.ts`.

**Never add a repo-root `railway.json`/`railway.toml`.** Both services build from this one
repo, so a root config applies its single `dockerfilePath` to both and the frontend comes up
serving the backend. This bug shipped twice. `.railway/railway.ts` is the only source of
truth (#35 in memory, DECISIONS).

## Verifying

```bash
npm test         # both workspaces — 159 backend + 7 frontend
npm run typecheck
```

A change to scoring or storage is not verified by tests alone — rehearse it against a copy
of the real database (pull one from the backups repo) before deploying. The v7 migration was
rehearsed that way and ran in 161ms on production.

After any Railway config change:

```bash
curl -sI https://btc-frontend-production-668a.up.railway.app/ | grep content-type
# must be text/html — application/json means the frontend is serving the backend again
```

## Deploying

`git push origin main` auto-deploys both services. Production health, including backup age
and storage headroom:

```bash
curl -s https://btc-backend-production-f698.up.railway.app/health | python3 -m json.tool
```

## Backups

App-side: verified `VACUUM INTO` snapshot at boot and 03:00 UTC daily, 7 kept, on the Railway
volume. Off-site: a daily GitHub Actions job in the **private** `btc-direction-backups` repo
publishes a gzipped snapshot as a release, 30 kept. The app-side snapshots share the volume
with the live database, so the off-site copy is the only one that survives losing it.

This repo is public; the backups repo is private and must stay that way — release assets on
a public repo are public downloads, and the snapshots are the whole accumulated dataset.

## Environment notes

- `gh` is at `/opt/homebrew/bin/gh` but missing from the non-interactive PATH — prefix with
  `export PATH="/opt/homebrew/bin:$PATH"`.
- Binance and Bybit are geo-blocked from Railway (fine locally). Candles/technicals fail over
  Binance → Kraken → Coinbase; order flow is built from pooled trades of whatever is connected.
- Another agent (OpenAI Codex CLI) has worked in this repo in parallel and left deployed work
  uncommitted. Run `git status` before editing.

## Style

Match the surrounding code. Comments explain *why* a non-obvious thing is done, not what the
line does — the existing comments are the reference for density and tone. When you fix a bug
that was not obvious, add a regression test that fails against the old behaviour and a
`DECISIONS.md` entry explaining what was actually wrong.
