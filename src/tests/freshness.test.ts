import { describe, it, expect } from 'vitest';
import { calculateFreshness } from '@/engine/data/provider';

describe('calculateFreshness', () => {
  it('identifies LIVE data within 30 minutes', () => {
    const now = 10000000;
    const ts = now - 10 * 60 * 1000;
    const res = calculateFreshness(ts, now);
    expect(res.state).toBe('LIVE');
    expect(res.ageMinutes).toBe(10);
  });

  it('identifies RECENT data between 31 and 180 minutes', () => {
    const now = 10000000;
    const ts = now - 60 * 60 * 1000;
    const res = calculateFreshness(ts, now);
    expect(res.state).toBe('RECENT');
  });

  it('identifies STALE data between 3 hours and 24 hours', () => {
    const now = 10000000;
    const ts = now - 5 * 60 * 60 * 1000;
    const res = calculateFreshness(ts, now);
    expect(res.state).toBe('STALE');
  });

  it('identifies UNAVAILABLE data older than 24 hours', () => {
    const now = 10000000;
    const ts = now - 30 * 60 * 60 * 1000;
    const res = calculateFreshness(ts, now);
    expect(res.state).toBe('UNAVAILABLE');
  });
});
