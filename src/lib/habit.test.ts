import { describe, expect, it } from 'vitest';
import type { DayRecord } from './db/types';
import { computeStreak, estimateMinutes, rhythmCells, weekday } from './habit';

const T = 20410;
const kept = (day: number, reviewed = 5): DayRecord => ({ day, reviewed, cleared: true, planned: reviewed });
const rest = (day: number): DayRecord => ({ day, reviewed: 0, cleared: false, planned: 0 });
const missed = (day: number): DayRecord => ({ day, reviewed: 2, cleared: false, planned: 9 });

/** Kept days from..to inclusive. */
const keptRange = (from: number, to: number) => {
  const out: DayRecord[] = [];
  for (let d = from; d <= to; d++) out.push(kept(d));
  return out;
};

describe('computeStreak', () => {
  it('empty history gives 0', () => {
    expect(computeStreak([], T)).toEqual({ length: 0, forgiven: [] });
  });

  it('counts today when kept', () => {
    expect(computeStreak(keptRange(T - 4, T), T).length).toBe(5);
  });

  it('starts yesterday when today is not kept yet', () => {
    expect(computeStreak([...keptRange(T - 4, T - 1), missed(T)], T).length).toBe(4);
    expect(computeStreak(keptRange(T - 4, T - 1), T).length).toBe(4);
  });

  it('rest days count and do not break the run', () => {
    const days = [kept(T - 4), rest(T - 3), rest(T - 2), kept(T - 1), kept(T)];
    expect(computeStreak(days, T)).toEqual({ length: 5, forgiven: [] });
  });

  it('forgives one missed day', () => {
    const days = [...keptRange(T - 5, T - 3), missed(T - 2), kept(T - 1), kept(T)];
    expect(computeStreak(days, T)).toEqual({ length: 6, forgiven: [T - 2] });
  });

  it('a missing row counts as missed', () => {
    const days = [...keptRange(T - 5, T - 3), kept(T - 1), kept(T)];
    expect(computeStreak(days, T)).toEqual({ length: 6, forgiven: [T - 2] });
  });

  it('a second miss within 6 days stops the run', () => {
    const days = [...keptRange(T - 10, T - 7), missed(T - 6), kept(T - 5), kept(T - 4), kept(T - 3), missed(T - 2), kept(T - 1), kept(T)];
    // T-2 forgiven; T-6 is 4 days earlier -> stop, run is T-5..T
    expect(computeStreak(days, T)).toEqual({ length: 6, forgiven: [T - 2] });
  });

  it('a second miss exactly 6 days earlier still stops; 7 days earlier is forgiven', () => {
    const six = keptRange(T - 12, T);
    const sixDays = six.filter((d) => d.day !== T - 1 && d.day !== T - 7);
    expect(computeStreak(sixDays, T)).toEqual({ length: 7, forgiven: [T - 1] });
    const sevenDays = six.filter((d) => d.day !== T - 1 && d.day !== T - 8);
    expect(computeStreak(sevenDays, T)).toEqual({ length: 13, forgiven: [T - 1, T - 8] });
  });

  it('trims rest and forgiven days from both ends', () => {
    // oldest end: forgiven then rest before the first kept day
    const days = [rest(T - 6), kept(T - 5), kept(T - 4), rest(T - 3), kept(T - 2)];
    expect(computeStreak([missed(T - 7), ...days], T - 2)).toEqual({ length: 4, forgiven: [] });
    // newest end: today not kept, yesterday missed (would be forgiven) -> trimmed
    expect(computeStreak([kept(T - 3), kept(T - 2), missed(T - 1)], T)).toEqual({ length: 2, forgiven: [] });
    // newest end: yesterday rest -> trimmed
    expect(computeStreak([kept(T - 3), kept(T - 2), rest(T - 1)], T).length).toBe(2);
  });

  it('no kept day gives 0', () => {
    expect(computeStreak([rest(T - 2), rest(T - 1)], T)).toEqual({ length: 0, forgiven: [] });
    expect(computeStreak([missed(T - 1)], T)).toEqual({ length: 0, forgiven: [] });
  });

  it('does not walk before the first row', () => {
    expect(computeStreak([kept(T - 1), kept(T)], T)).toEqual({ length: 2, forgiven: [] });
  });
});

describe('rhythmCells', () => {
  it('has 84 cells from a Monday to a Sunday containing today', () => {
    for (const today of [T, T + 1, T + 3, T + 6]) {
      const cells = rhythmCells([], today);
      expect(cells).toHaveLength(84);
      expect(weekday(cells[0].day)).toBe(0);
      expect(weekday(cells[83].day)).toBe(6);
      expect(cells.slice(77).some((c) => c.day === today)).toBe(true);
      for (let i = 1; i < 84; i++) expect(cells[i].day).toBe(cells[i - 1].day + 1);
    }
  });

  it('day 4 (1970-01-05) is a Monday', () => {
    expect(weekday(4)).toBe(0);
    expect(weekday(0)).toBe(3);
  });

  it('statuses: future, none today until kept, kept, rest, forgiven, missed', () => {
    const today = T;
    const days = [kept(today - 5), missed(today - 4), kept(today - 3), rest(today - 2), kept(today - 1)];
    const at = (cells: ReturnType<typeof rhythmCells>, d: number) => cells.find((c) => c.day === d)!;
    let cells = rhythmCells(days, today);
    expect(at(cells, today).status).toBe('none');
    expect(at(cells, today - 1).status).toBe('kept');
    expect(at(cells, today - 2).status).toBe('rest');
    expect(at(cells, today - 4).status).toBe('forgiven');
    expect(at(cells, today - 6).status).toBe('missed');
    expect(cells.filter((c) => c.day > today).every((c) => c.status === 'future' && c.level === 0)).toBe(true);
    cells = rhythmCells([...days, kept(today)], today);
    expect(at(cells, today).status).toBe('kept');
  });

  it('levels from reviewed counts', () => {
    const today = T;
    const cells = rhythmCells([kept(today - 3, 0), kept(today - 2, 10), kept(today - 1, 11), kept(today, 61)], today);
    const lv = (d: number) => cells.find((c) => c.day === d)!.level;
    expect([lv(today - 3), lv(today - 2), lv(today - 1), lv(today)]).toEqual([1, 1, 2, 4]);
    expect(rhythmCells([kept(today, 31), kept(today - 1, 60)], today).filter((c) => c.status === 'kept').map((c) => c.level)).toEqual([3, 3]);
  });
});

describe('estimateMinutes', () => {
  it('rounds up, at least 1, 0 for nothing due', () => {
    expect(estimateMinutes(0, 8)).toBe(0);
    expect(estimateMinutes(1, 8)).toBe(1);
    expect(estimateMinutes(42, 8)).toBe(6);
  });
});
