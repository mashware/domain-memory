// Confidence decay logic. DESIGN.md specifies that entries lose 5 points
// every 30 days without being touched. We implement this lazily: the
// stored `confidence` is the base value (set by writes and explicit
// verification), and the *effective* confidence is computed at read time
// by applying the decay since `last_verified`.
//
// Lazy decay has two benefits: (1) writes never need to race against a
// scheduled decay job, and (2) the decayed value is always consistent
// with the clock, no matter when the index was last touched.

const DECAY_POINTS_PER_PERIOD = 5;
const DECAY_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_CONFIDENCE = 0;

export function effectiveConfidence(
  stored: number,
  lastVerified: string,
  now: Date = new Date(),
): number {
  const verifiedAt = Date.parse(lastVerified);
  if (Number.isNaN(verifiedAt)) return stored;

  const elapsed = now.getTime() - verifiedAt;
  if (elapsed <= 0) return stored;

  const periods = Math.floor(elapsed / DECAY_PERIOD_MS);
  if (periods === 0) return stored;

  const decayed = stored - periods * DECAY_POINTS_PER_PERIOD;
  return Math.max(MIN_CONFIDENCE, decayed);
}

export const DECAY_CONSTANTS = {
  pointsPerPeriod: DECAY_POINTS_PER_PERIOD,
  periodMs: DECAY_PERIOD_MS,
  minConfidence: MIN_CONFIDENCE,
} as const;
