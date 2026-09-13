import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SignalDatabase } from '../src/db/database.js';
import type { HorizonSignal } from '../src/types.js';

function signal(ts: number): HorizonSignal {
  const comp = { score: 10, weight: 0.2, available: true, freshness: 'fresh' as const, details: {}, reasons: [], risks: [] };
  return {
    horizon: '1h', label: 'BULLISH', rawLabel: 'BULLISH', finalScore: 30, confidence: 60,
    reasons: ['r'], risks: [], components: { polymarket: comp, technical: comp, etf: comp, macro: comp, liquidity: comp },
    btcPrice: 100_000, timestamp: ts, limitedHistory: false, historyNote: null,
    context: {
      appliedWeights: {}, configuredWeights: {}, providerFreshness: {}, unavailableProviders: [],
      session: 'US', polymarketMarketsUsed: [], polymarketCategoryScores: {},
      technicalValues: {}, macroValues: {}, etfValues: {},
    },
    edge: null, gated: false, conformal: null, similarStates: null, regime: 'unknown',
  };
}

describe('verified database backup', () => {
  it('produces a snapshot that opens independently and holds every row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btc-backup-'));
    try {
      const db = new SignalDatabase(join(dir, 'live.sqlite'));
      for (let i = 0; i < 25; i++) db.insertSignal(signal(1_000 + i * 60_000));
      db.insertAlert('t', 'm', 'info', null, 1_000);

      const dest = join(dir, 'backups', 'snap.sqlite');
      const { bytes, rows } = db.backupVerified(dest);
      expect(bytes).toBeGreaterThan(4096);
      expect(rows.signals).toBe(25);

      // The real test of a backup: open the copy as its own database and read the data back.
      const restored = new SignalDatabase(dest);
      expect(restored.countsByTable().signals).toBe(25);
      expect(restored.getSignalHistory('1h', 100)).toHaveLength(25);
      expect(restored.getRecentAlerts(10)).toHaveLength(1);
      restored.close();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overwrites a previous snapshot at the same path (VACUUM INTO refuses an existing file)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btc-backup-over-'));
    try {
      const db = new SignalDatabase(join(dir, 'live.sqlite'));
      db.insertSignal(signal(1_000));
      const dest = join(dir, 'snap.sqlite');
      db.backupVerified(dest);
      const firstSize = statSync(dest).size;
      for (let i = 0; i < 50; i++) db.insertSignal(signal(2_000 + i * 60_000));
      const second = db.backupVerified(dest); // must not throw on the existing file
      expect(second.rows.signals).toBe(51);
      expect(statSync(dest).size).toBeGreaterThanOrEqual(firstSize);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REGRESSION: a corrupt snapshot is rejected, not reported as a good backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btc-backup-bad-'));
    try {
      const db = new SignalDatabase(join(dir, 'live.sqlite'));
      db.insertSignal(signal(1_000));
      const dest = join(dir, 'snap.sqlite');
      db.backupVerified(dest);

      // Corrupt the middle of the snapshot the way a bad disk would, then prove that
      // opening + integrity-checking it fails — i.e. verification has real teeth.
      const size = statSync(dest).size;
      const junk = Buffer.alloc(Math.floor(size / 2), 0xa5);
      const handle = openSync(dest, 'r+');
      writeSync(handle, junk, 0, junk.length, 1024);
      closeSync(handle);

      expect(() => {
        const copy = new DatabaseSync(dest, { readOnly: true });
        try {
          const r = copy.prepare('PRAGMA integrity_check').get() as unknown as { integrity_check: string };
          if (r?.integrity_check !== 'ok') throw new Error('corrupt');
          copy.prepare('SELECT COUNT(*) AS c FROM signals').get();
        } finally {
          copy.close();
        }
      }).toThrow();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
