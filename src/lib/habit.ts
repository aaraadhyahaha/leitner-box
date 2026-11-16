import type { DayRecord } from './db/types';

export type CellStatus = 'kept' | 'rest' | 'forgiven' | 'missed' | 'future' | 'none';
export interface RhythmCell { day: number; status: CellStatus; level: 0 | 1 | 2 | 3 | 4 }

const FORGIVE_WINDOW = 6; // a forgiven day blocks forgiving another in the next 6 days
const GRID_WEEKS = 12;

type Kind = 'kept' | 'rest' | 'missed';

function kindOf(r: DayRecord | undefined): Kind {
  if (r?.cleared) return 'kept';
  if (r && r.planned === 0) return 'rest';
  return 'missed';
}

function index(days: DayRecord[]): Map<number, DayRecord> {
  return new Map(days.map((d) => [d.day, d]));
}

/**
 * Forgiving day streak. Kept and rest days continue a run; one missed day in any 7 is forgiven.
 * The run starts and ends on a kept day, so rest or forgiven days at either end are trimmed.
 */
export function computeStreak(days: DayRecord[], today: number): { length: number; forgiven: number[] } {
  if (days.length === 0) return { length: 0, forgiven: [] };
  const byDay = index(days);
  let first = Infinity;
  for (const d of days) first = Math.min(first, d.day);

  const run: { day: number; kind: Kind; forgiven: boolean }[] = [];
  let lastForgiven = Infinity;
  const start = kindOf(byDay.get(today)) === 'kept' ? today : today - 1;
  for (let d = start; d >= first; d--) {
    const k = kindOf(byDay.get(d));
    if (k === 'missed') {
      if (lastForgiven - d <= FORGIVE_WINDOW) break;
      lastForgiven = d;
      run.push({ day: d, kind: k, forgiven: true });
    } else {
      run.push({ day: d, kind: k, forgiven: false });
    }
  }

  let lo = 0;
  let hi = run.length - 1;
  while (lo <= hi && run[lo].kind !== 'kept') lo++;
  while (hi >= lo && run[hi].kind !== 'kept') hi--;
  if (lo > hi) return { length: 0, forgiven: [] };
  const kept = run.slice(lo, hi + 1);
  return { length: kept.length, forgiven: kept.filter((r) => r.forgiven).map((r) => r.day) };
}

/** Monday = 0 (day 0, 1970-01-01, was a Thursday). */
export function weekday(day: number): number {
  return (((day + 3) % 7) + 7) % 7;
}

function level(reviewed: number): 1 | 2 | 3 | 4 {
  if (reviewed <= 10) return 1;
  if (reviewed <= 30) return 2;
  if (reviewed <= 60) return 3;
  return 4;
}

/** 84 cells: Monday 11 weeks before today's week through this week's Sunday, ascending. */
export function rhythmCells(days: DayRecord[], today: number): RhythmCell[] {
  const byDay = index(days);
  const forgiven = new Set(computeStreak(days, today).forgiven);
  const start = today - weekday(today) - (GRID_WEEKS - 1) * 7;
  const cells: RhythmCell[] = [];
  for (let d = start; d < start + GRID_WEEKS * 7; d++) {
    const r = byDay.get(d);
    const k = kindOf(r);
    let status: CellStatus;
    if (d > today) status = 'future';
    else if (k === 'kept') status = 'kept';
    else if (d === today) status = 'none';
    else if (k === 'rest') status = 'rest';
    else if (forgiven.has(d)) status = 'forgiven';
    else status = 'missed';
    cells.push({ day: d, status, level: status === 'kept' ? level(r?.reviewed ?? 0) : 0 });
  }
  return cells;
}

export function estimateMinutes(due: number, secondsPerCard: number): number {
  if (due <= 0) return 0;
  return Math.max(1, Math.ceil((due * secondsPerCard) / 60));
}
