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
    for (const [id, name] of db.selectArrays(
      'SELECT id, name FROM decks WHERE remind = 1 ORDER BY name COLLATE NOCASE, id',
    )) {
      const f: DeckForecast = { deckId: Number(id), name: String(name), byDay: new Array(FORECAST_DAYS).fill(0) };
      forecast.push(f);
    }
    const totals: number[] = new Array(FORECAST_DAYS).fill(0);
    // Per deck: one index-range count for today incl. overdue, then the next 30 days grouped by
    // day. Both stream on cards_deck_due; a single GROUP BY over MAX(due_day - today, 0) needs a
    // temp B-tree over every due card (31 ms at 100k vs 4 ms).
    const dueNow = db.prepare('SELECT COUNT(*) FROM cards WHERE deck_id = ? AND due_day <= ?');
    const ahead = db.prepare(
      'SELECT due_day, COUNT(*) FROM cards WHERE deck_id = ? AND due_day BETWEEN ? AND ? GROUP BY due_day',
    );
    try {
      for (const f of forecast) {
        dueNow.bind([f.deckId, today]).step();
        f.byDay[0] = Number(dueNow.get(0));
        dueNow.reset(true);
        ahead.bind([f.deckId, today + 1, today + FORECAST_DAYS - 1]);
        while (ahead.step()) f.byDay[Number(ahead.get(0)) - today] = Number(ahead.get(1));
        ahead.reset(true);
        for (let i = 0; i < FORECAST_DAYS; i++) totals[i] += f.byDay[i];
      }
    } finally {
      dueNow.finalize();
      ahead.finalize();
    }

    // Nothing due: today is cleared only if something was reviewed (an empty day is a rest day).
    if (totals[0] === 0) {
      db.exec({
        sql: 'UPDATE days SET cleared = 1 WHERE day = ? AND reviewed > 0',
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
            ON CONFLICT(day) DO UPDATE SET planned = MAX(COALESCE(planned, 0), excluded.planned)`,
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
