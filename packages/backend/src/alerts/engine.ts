import { ALERT_THRESHOLDS } from '../config.js';
import type { SignalDatabase } from '../db/database.js';
import type { SignalBundle, PolymarketSnapshot, BitcoinTechnicals, Horizon } from '../types.js';

/**
 * Alert sinks are pluggable: the in-app sink writes to SQLite; Telegram/email/push
 * sinks can be added later by implementing AlertSink and registering it.
 */
export interface AlertSink {
  deliver(type: string, message: string, severity: 'info' | 'warning' | 'critical', horizon: Horizon | null): void;
}

export class DatabaseAlertSink implements AlertSink {
  constructor(private db: SignalDatabase) {}
  deliver(type: string, message: string, severity: 'info' | 'warning' | 'critical', horizon: Horizon | null): void {
    const dedupWindow = 60 * 60_000;
    if (this.db.hasRecentAlert(type, message, Date.now() - dedupWindow)) return;
    this.db.insertAlert(type, message, severity, horizon, Date.now());
  }
}

export class AlertEngine {
  private sinks: AlertSink[] = [];
  private prevBundle: SignalBundle | null = null;
  private prevVolume: number | null = null;

  addSink(sink: AlertSink): void {
    this.sinks.push(sink);
  }

  private emit(type: string, message: string, severity: 'info' | 'warning' | 'critical', horizon: Horizon | null): void {
    for (const sink of this.sinks) sink.deliver(type, message, severity, horizon);
  }

  evaluate(bundle: SignalBundle, polySnapshot: PolymarketSnapshot | null, tech: BitcoinTechnicals | null): void {
    if (this.prevBundle) {
      for (const [horizon, signal] of Object.entries(bundle.signals)) {
        const prev = this.prevBundle.signals[horizon as Horizon];
        if (!prev) continue;

        if (prev.label !== signal.label) {
          const severity = signal.label === 'NEUTRAL' ? 'info' : 'warning';
          this.emit(
            'label-flip',
            `${horizon} signal flipped ${prev.label} → ${signal.label} (score ${signal.finalScore})`,
            severity,
            horizon as Horizon,
          );
        }

        const confDelta = Math.abs(signal.confidence - prev.confidence);
        if (confDelta > ALERT_THRESHOLDS.confidenceJump) {
          this.emit(
            'confidence-jump',
            `${horizon} confidence moved ${prev.confidence} → ${signal.confidence}`,
            'info',
            horizon as Horizon,
          );
        }
      }
    }

    if (polySnapshot) {
      for (const m of polySnapshot.markets) {
        if (m.probChange1h !== null && Math.abs(m.probChange1h) >= ALERT_THRESHOLDS.polymarketProbJump) {
          const pp = (m.probChange1h * 100).toFixed(1);
          const severity = m.category === 'btc-direct' ? 'warning' : 'info';
          this.emit(
            'polymarket-move',
            `"${m.title.slice(0, 60)}" moved ${m.probChange1h > 0 ? '+' : ''}${pp}pp in 1h`,
            severity,
            null,
          );
        }
      }
    }

    if (tech && tech.volume24h !== null && this.prevVolume !== null && this.prevVolume > 0) {
      const ratio = tech.volume24h / this.prevVolume;
      if (ratio >= ALERT_THRESHOLDS.volumeSpikeRatio) {
        this.emit('volume-spike', `BTC 24h volume spiked ${((ratio - 1) * 100).toFixed(0)}% vs previous check`, 'warning', null);
      }
    }

    this.prevBundle = bundle;
    if (tech?.volume24h != null) this.prevVolume = tech.volume24h;
  }
}
