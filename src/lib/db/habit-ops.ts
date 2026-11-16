import type { Database } from '@sqlite.org/sqlite-wasm';
import { dayNumber } from '../leitner';
import type { DayRecord, DeckForecast, HabitSummary } from './types';

// Must not import from ops.ts or card-ops.ts (they import this file).

const FORECAST_DAYS = 31;
const HISTORY_DAYS = 365;
const PACE_REVIEWS = 300;
const PACE_MAX_GAP_MS = 120_000;
const DEFAULT_SPC = 8;

/** True if any card in a reminded deck is due on or before `today`. */
export function remindedDue(db: Database, today: number): boolean {
  return Number(db.selectValue(
    `SELECT EXISTS(SELECT 1 FROM cards c JOIN decks d ON d.id = c.deck_id
                    WHERE d.remind = 1 AND c.due_day <= ?)`,
    [today],
  )) === 1;
}

/** Call inside the answer transaction, after the review insert. `cleared` is sticky. */
export function recordAnswer(db: Database, today: number): void {
  db.exec({
    sql: `INSERT INTO days(day, reviewed, cleared) VALUES (?, 1, ?)
          ON CONFLICT(day) DO UPDATE SET reviewed = reviewed + 1, cleared = MAX(cleared, excluded.cleared)`,
    bind: [today, remindedDue(db, today) ? 0 : 1],
  });
}

/** Call inside the undo transaction, after the card is restored. Only today is re-cleared (not sticky). */
export function recordUndo(db: Database, reviewedAt: number, today: number, tzOffsetMin: number): void {
  const day = dayNumber(reviewedAt, tzOffsetMin);
  db.exec({ sql: 'UPDATE days SET reviewed = MAX(reviewed - 1, 0) WHERE day = ?', bind: [day] });
  if (day === today) {
    db.exec({
      sql: 'UPDATE days SET cleared = ? WHERE day = ?',
      bind: [remindedDue(db, today) ? 0 : 1, today],
    });
  }
}

export function setRemind(db: Database, id: number, remind: boolean): void {
  db.exec({ sql: 'UPDATE decks SET remind = ? WHERE id = ?', bind: [remind ? 1 : 0, id] });
  if (db.changes() === 0) throw new Error('Deck not found');
}

function secondsPerCard(db: Database): number {
  const times = db.selectArrays(
    'SELECT reviewed_at FROM reviews ORDER BY reviewed_at DESC LIMIT ?', [PACE_REVIEWS],
  ).map((r) => Number(r[0]));
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const g = times[i - 1] - times[i];
    if (g > 0 && g < PACE_MAX_GAP_MS) gaps.push(g);
  }
  if (gaps.length < 5) return DEFAULT_SPC;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  const s = Math.min(60, Math.max(3, median / 1000));
  return Math.round(s * 10) / 10;
}

export function habitSummary(db: Database, today: number): HabitSummary {
  return db.transaction(() => {
    const forecast: DeckForecast[] = [];
    const byId = new Map<number, DeckForecast>();
    for (const [id, name] of db.selectArrays(
      'SELECT id, name FROM decks WHERE remind = 1 ORDER BY name COLLATE NOCASE, id',
    )) {
      const f: DeckForecast = { deckId: Number(id), name: String(name), byDay: new Array(FORECAST_DAYS).fill(0) };
      forecast.push(f);
      byId.set(f.deckId, f);
    }
    const totals: number[] = new Array(FORECAST_DAYS).fill(0);
    for (const [deckId, offset, n] of db.selectArrays(
      `SELECT c.deck_id, MAX(c.due_day - ?, 0), COUNT(*)
         FROM cards c JOIN decks d ON d.id = c.deck_id
        WHERE d.remind = 1 AND c.due_day <= ?
        GROUP BY 1, 2`,
      [today, today + FORECAST_DAYS - 1],
    )) {
      const f = byId.get(Number(deckId));
      const i = Number(offset);
      if (!f || i < 0 || i >= FORECAST_DAYS) continue;
      f.byDay[i] += Number(n);
      totals[i] += Number(n);
    }

    if (totals[0] === 0) {
      db.exec({
        sql: 'INSERT INTO days(day, cleared) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET cleared = 1',
        bind: [today],
      });
    }
    const upPlanned = db.prepare(
      'INSERT INTO days(day, planned) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET planned = excluded.planned',
    );
    try {
      for (let i = 1; i < FORECAST_DAYS; i++) {
        upPlanned.bind([today + i, totals[i]]).step();
        upPlanned.reset(true);
      }
    } finally {
      upPlanned.finalize();
    }
    db.exec({
      sql: `INSERT INTO days(day, planned) VALUES (?, ?)
            ON CONFLICT(day) DO UPDATE SET planned = COALESCE(planned, excluded.planned)`,
      bind: [today, totals[0]],
    });

    const days: DayRecord[] = db.selectArrays(
      'SELECT day, reviewed, cleared, planned FROM days WHERE day BETWEEN ? AND ? ORDER BY day',
      [today - HISTORY_DAYS, today],
    ).map(([day, reviewed, cleared, planned]) => ({
      day: Number(day),
      reviewed: Number(reviewed),
      cleared: Number(cleared) === 1,
      planned: planned === null || planned === undefined ? null : Number(planned),
    }));

    return { today, days, secondsPerCard: secondsPerCard(db), forecast };
  });
}
