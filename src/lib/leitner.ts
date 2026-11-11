import type { Box } from './db/types';

export const BOX_COUNT = 5;

/** Review interval in days for boxes 1..5. */
export const INTERVALS: readonly number[] = Object.freeze([1, 2, 4, 8, 16]);

const MS_PER_DAY = 86_400_000;

/**
 * Local calendar day number.
 * @param tzOffsetMin value of `Date.prototype.getTimezoneOffset()` (e.g. -330 for UTC+5:30).
 */
export function dayNumber(epochMs: number, tzOffsetMin: number): number {
  return Math.floor((epochMs - tzOffsetMin * 60_000) / MS_PER_DAY);
}

/** Apply one Leitner review. Correct moves up one box (max 5); wrong goes to box 1. */
export function review(box: Box, correct: boolean, today: number): { box: Box; dueDay: number } {
  const next = (correct ? Math.min(box + 1, BOX_COUNT) : 1) as Box;
  return { box: next, dueDay: today + INTERVALS[next - 1] };
}
