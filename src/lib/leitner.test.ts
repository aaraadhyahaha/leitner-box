import { describe, expect, it } from 'vitest';
import type { Box } from './db/types';
import { BOX_COUNT, INTERVALS, dayNumber, review } from './leitner';

describe('constants', () => {
  it('has 5 boxes with doubling intervals', () => {
    expect(BOX_COUNT).toBe(5);
    expect(INTERVALS).toEqual([1, 2, 4, 8, 16]);
  });
});

describe('review', () => {
  const today = 1000;
  const boxes: Box[] = [1, 2, 3, 4, 5];

  it.each([
    [1, 2, 2],
    [2, 3, 4],
    [3, 4, 8],
    [4, 5, 16],
    [5, 5, 16],
  ] as const)('correct from box %i -> box %i, due +%i', (from, to, days) => {
    expect(review(from, true, today)).toEqual({ box: to, dueDay: today + days });
  });

  it('wrong from every box -> box 1, due tomorrow', () => {
    for (const b of boxes) {
      expect(review(b, false, today)).toEqual({ box: 1, dueDay: today + 1 });
    }
  });

  it('box 5 stays 5 on repeated correct answers', () => {
    let state = review(5, true, today);
    state = review(state.box, true, state.dueDay);
    expect(state.box).toBe(5);
  });
});

describe('dayNumber', () => {
  it('is the UTC day with zero offset', () => {
    expect(dayNumber(0, 0)).toBe(0);
    expect(dayNumber(86_400_000 - 1, 0)).toBe(0);
    expect(dayNumber(86_400_000, 0)).toBe(1);
  });

  it('rolls over at local midnight for UTC+5:30', () => {
    const tz = -330;
    // 2026-01-01T18:29:59.999Z = 23:59:59.999 local on Jan 1
    const before = Date.UTC(2026, 0, 1, 18, 29, 59, 999);
    // 2026-01-01T18:30:00Z = 00:00 local on Jan 2
    const after = Date.UTC(2026, 0, 1, 18, 30, 0, 0);
    const utcDay = Math.floor(Date.UTC(2026, 0, 1) / 86_400_000);
    expect(dayNumber(before, tz)).toBe(utcDay);
    expect(dayNumber(after, tz)).toBe(utcDay + 1);
  });

  it('rolls over at local midnight for UTC-5', () => {
    const tz = 300;
    // 2026-01-02T04:59:59.999Z = 23:59:59.999 local on Jan 1
    const before = Date.UTC(2026, 0, 2, 4, 59, 59, 999);
    // 2026-01-02T05:00:00Z = 00:00 local on Jan 2
    const after = Date.UTC(2026, 0, 2, 5, 0, 0, 0);
    const jan1 = Math.floor(Date.UTC(2026, 0, 1) / 86_400_000);
    expect(dayNumber(before, tz)).toBe(jan1);
    expect(dayNumber(after, tz)).toBe(jan1 + 1);
  });

  it('same instant can be different local days in different zones', () => {
    const t = Date.UTC(2026, 0, 1, 20, 0); // 20:00Z Jan 1
    expect(dayNumber(t, -330) - dayNumber(t, 300)).toBe(1);
  });
});
