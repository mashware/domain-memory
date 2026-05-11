import { describe, expect, it } from 'vitest';
import { DECAY_CONSTANTS, effectiveConfidence } from './confidence.js';

describe('effectiveConfidence', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('does not decay when verified today', () => {
    const now = new Date('2026-04-11T00:00:00Z');
    const verified = new Date('2026-04-11T00:00:00Z').toISOString();
    expect(effectiveConfidence(80, verified, now)).toBe(80);
  });

  it('does not decay before the first 30-day period is complete', () => {
    const now = new Date('2026-04-11T00:00:00Z');
    const verified = new Date(now.getTime() - 15 * DAY).toISOString();
    expect(effectiveConfidence(80, verified, now)).toBe(80);
  });

  it('drops 5 points after a single 30-day period', () => {
    const now = new Date('2026-04-11T00:00:00Z');
    const verified = new Date(now.getTime() - 35 * DAY).toISOString();
    expect(effectiveConfidence(80, verified, now)).toBe(75);
  });

  it('compounds across multiple periods', () => {
    const now = new Date('2026-04-11T00:00:00Z');
    const verified = new Date(now.getTime() - 95 * DAY).toISOString(); // 3 full periods
    expect(effectiveConfidence(80, verified, now)).toBe(65);
  });

  it('floors at 0 even when decay would go negative', () => {
    const now = new Date('2026-04-11T00:00:00Z');
    const verified = new Date(now.getTime() - 10_000 * DAY).toISOString();
    expect(effectiveConfidence(80, verified, now)).toBe(0);
  });

  it('does not amplify stored confidence when last_verified is in the future', () => {
    const now = new Date('2026-04-11T00:00:00Z');
    const verified = new Date(now.getTime() + 365 * DAY).toISOString();
    expect(effectiveConfidence(80, verified, now)).toBe(80);
  });

  it('returns stored value when last_verified is unparseable', () => {
    expect(effectiveConfidence(80, 'not-a-date')).toBe(80);
  });

  it('exposes decay constants for external callers', () => {
    expect(DECAY_CONSTANTS.pointsPerPeriod).toBe(5);
    expect(DECAY_CONSTANTS.periodMs).toBe(30 * DAY);
    expect(DECAY_CONSTANTS.minConfidence).toBe(0);
  });
});
