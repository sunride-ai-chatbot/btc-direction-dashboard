import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SignalDatabase } from '../src/db/database.js';
import { PRUNE_CONFIG } from '../src/config.js';

const DAY = 24 * 3_600_000;

function seed(db: SignalDatabase, ts: number) {
  db.insertPolymarketSnapshot([{ marketId: `m-${ts}`, title: 't', probability: 0.5, volume: 1, liquidity: 1, ts }]);
  db.insertBtcPrice(ts, 100_000, 1);
}

describe('raw input retention', () => {
  it('REGRESSION: a 40-day-old raw input survives the default retention', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btc-retention-'));
    try {
      const db = new SignalDatabase(join(dir, 'r.sqlite'));
      const old = Date.now() - 40 * DAY;
      seed(db, old);
      expect(db.countsByTable().btc_price_history).toBe(1);

      // The old policy deleted anything past 30 days; these rows are the only record of
      // what the providers said and the only way to re-score history, so they must stay.
      db.pruneOldData(PRUNE_CONFIG.days * DAY);
      expect(db.countsByTable().btc_price_history).toBe(1);
      expect(db.countsByTable().polymarket_history).toBe(1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still prunes past the retention, reports what it deleted, and never touches signals', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btc-retention-old-'));
    try {
      const db = new SignalDatabase(join(dir, 'r.sqlite'));
      seed(db, Date.now() - 400 * DAY);
      seed(db, Date.now() - 1 * DAY);
      const before = db.countsByTable();

      const deleted = db.pruneOldData(PRUNE_CONFIG.days * DAY);
      expect(deleted.btc_price_history).toBe(1);
      expect(deleted.polymarket_history).toBe(1);
      expect(db.countsByTable().btc_price_history).toBe(1); // the recent one remains
      expect(db.countsByTable().signals).toBe(before.signals); // signals are never pruned
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retention default is long enough that raw inputs outlive a scoring change', () => {
    expect(PRUNE_CONFIG.days).toBeGreaterThanOrEqual(180);
    expect(PRUNE_CONFIG.pressureDays).toBeLessThan(PRUNE_CONFIG.days);
  });
});
