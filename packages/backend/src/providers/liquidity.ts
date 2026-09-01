import type { LiquidityContext } from '../types.js';

/**
 * Session quality by Israel local hour (Asia/Jerusalem).
 * Values are confidence modifiers, NOT direction predictors.
 *   EU/US overlap (16:30-19:00 IL) — deepest liquidity
 *   US hours (19:00-23:00 IL) — high
 *   EU hours (10:00-16:30 IL) — good
 *   Asia (03:00-10:00 IL) — moderate
 *   Overnight gap (23:00-03:00 IL) — thin
 */
export function getLiquidityContext(now: Date = new Date(), volumeQuality = 0.5): LiquidityContext {
  const israelHour = getIsraelHour(now);
  const { name, quality } = sessionFor(israelHour);
  return {
    sessionName: name,
    sessionQuality: quality,
    volumeQuality,
    israelHour,
    timestamp: now.getTime(),
  };
}

export function getIsraelHour(now: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: 'numeric',
    hour12: false,
  });
  return Number.parseInt(formatter.format(now), 10) % 24;
}

export function sessionFor(israelHour: number): { name: string; quality: number } {
  if (israelHour >= 17 && israelHour < 19) return { name: 'EU/US overlap', quality: 1.0 };
  if (israelHour >= 19 && israelHour < 23) return { name: 'US session', quality: 0.9 };
  if (israelHour >= 10 && israelHour < 17) return { name: 'European session', quality: 0.8 };
  if (israelHour >= 3 && israelHour < 10) return { name: 'Asian session', quality: 0.6 };
  return { name: 'Overnight (thin liquidity)', quality: 0.4 };
}

/** Volume quality: current 24h volume relative to what's typical. 0..1 */
export function computeVolumeQuality(volume24h: number | null, volumeChange24h: number | null): number {
  if (volume24h === null) return 0.5;
  if (volumeChange24h === null) return 0.5;
  if (volumeChange24h > 50) return 1.0;
  if (volumeChange24h > 10) return 0.8;
  if (volumeChange24h > -20) return 0.6;
  return 0.35;
}
