/**
 * Scoring epochs.
 *
 * A stored signal is only comparable with another if both were produced by a
 * scoring pipeline that means the same thing by "score". When a bug is fixed or
 * an input changes sign, older rows do not become wrong data — they become
 * *answers to a different question*, and pooling them with new rows silently
 * corrupts every accuracy and edge number computed from the pool.
 *
 * So every signal carries the version that produced it, and reports pool only
 * versions at or above MIN_POOLABLE_VERSION. Nothing is deleted: older epochs
 * stay queryable and are reported separately.
 */

/** Version stamped on rows written by this build. Bump when scoring semantics change. */
export const SCORING_VERSION = 3;

/**
 * The v1 → v2 boundary, measured from production data rather than a deploy log:
 * `signals.macro_score` for 1h steps +22.20 → −21.19 at this instant, which is the
 * Polymarket parser fix (commit 3e95516) taking effect. See DECISIONS #72–74.
 */
export const PARSER_FIX_TS = 1_789_287_670_983;

export interface ScoringEpoch {
  version: number;
  /** Why rows from this epoch are not comparable with later ones. */
  summary: string;
  poolable: boolean;
}

export const SCORING_EPOCHS: ScoringEpoch[] = [
  {
    version: 1,
    summary:
      'Polymarket policy parser matched substrings, so "incr(ease)" read as easing: the most liquid Fed market was scored with an inverted sign and fedCutProbability was derived from it. Polymarket and macro components carry a wrong-sign input.',
    poolable: false,
  },
  {
    version: 2,
    summary:
      'Parser corrected (whole-word matching, explicit policy direction, cut probability derived only from parsed cut markets).',
    poolable: true,
  },
  {
    version: 3,
    summary:
      'Technical component reports unavailable when no indicator could be computed, instead of contributing a 0 score at full weight.',
    poolable: true,
  },
];

/**
 * Lowest version that may be pooled with the current one.
 *
 * v2 and v3 differ only in the price-only technical branch, and that branch fired
 * on 0 of the 548 signals written during v2 (the candle work in commits 2b10b5b /
 * 4cbaf85 had already restored indicator data), so v2 rows are arithmetically
 * identical to what v3 would have produced. They are pooled on that evidence, not
 * on the assumption that the change was harmless.
 */
export const MIN_POOLABLE_VERSION = 2;

export function isPoolable(version: number | null | undefined): boolean {
  return typeof version === 'number' && version >= MIN_POOLABLE_VERSION;
}

/** Version to attribute a pre-existing row to, from the timestamp of the signal. */
export function versionForTimestamp(ts: number): number {
  return ts < PARSER_FIX_TS ? 1 : 2;
}
