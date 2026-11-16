import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { dayNumber } from '../leitner';
import { answerCard, listDecks, migrate } from './ops';
import { undoReview } from './card-ops';
import { habitSummary, setRemind } from './habit-ops';
import { SCHEMA_V1 } from './schema';

const DAY_MS = 86_400_000;

let sqlite3: Sqlite3Static;
let db: Database;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

beforeEach(() => {
  db = new sqlite3.oo1.DB(':memory:');
  migrate(db, 0);
});

afterEach(() => {
  db.close();
});

function deck(name: string): number {
  db.exec({ sql: 'INSERT INTO decks(name, created_at) VALUES (?, 0)', bind: [name] });
  return Number(db.selectValue('SELECT last_insert_rowid()'));
}

let seq = 0;
function card(deckId: number, dueDay: number): number {
  seq++;
  db.exec({
    sql: `INSERT INTO cards(deck_id, front, back, hash, due_day, created_at, updated_at)
          VALUES (?, ?, 'b', ?, ?, 0, 0)`,
    bind: [deckId, `f${seq}`, `h${seq}`, dueDay],
  });
  return Number(db.selectValue('SELECT last_insert_rowid()'));
}

const dayRow = (day: number) => db.selectObject('SELECT reviewed, cleared, planned FROM days WHERE day = ?', [day]);

describe('migration', () => {
  it('fresh DB is version 2 and decks remind by default', () => {
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(2);
    deck('A');
    expect(listDecks(db, 0)[0].remind).toBe(true);
  });

  it('is safe to run twice', () => {
    migrate(db, 0);
    expect(Number(db.selectValue('PRAGMA user_version'))).toBe(2);
  });

  it('upgrades v1 and backfills days from reviews', () => {
    const old = new sqlite3.oo1.DB(':memory:');
    try {
      old.exec(SCHEMA_V1);
      old.exec("INSERT INTO decks(name, created_at) VALUES ('A', 0)");
      old.exec("INSERT INTO cards(deck_id, front, back, hash, due_day, created_at, updated_at) VALUES (1, 'f', 'b', 'h', 0, 0, 0)");
      const d1 = 20000;
      const d2 = 20003;
      const ins = (t: number) => old.exec({
        sql: 'INSERT INTO reviews(card_id, reviewed_at, correct, prev_box, prev_due_day, new_box, new_due_day) VALUES (1, ?, 1, 1, 0, 2, 0)',
        bind: [t],
      });
      ins(d1 * DAY_MS + 1000);
      ins(d1 * DAY_MS + 5000);
      ins(d2 * DAY_MS + DAY_MS - 1);
      migrate(old, 0);
      expect(Number(old.selectValue('PRAGMA user_version'))).toBe(2);
      expect(old.selectArrays('SELECT day, reviewed, cleared FROM days ORDER BY day')).toEqual([
        [d1, 2, 1], [d2, 1, 1],
      ]);
      expect(Number(old.selectValue('SELECT remind FROM decks'))).toBe(1);
    } finally {
      old.close();
    }
  });
});

describe('answer and undo', () => {
  const T = 20000;
  const NOW = T * DAY_MS + 3600_000;

  it('clears today once every reminded card is answered', () => {
    const d = deck('A');
    const a = card(d, T);
    const b = card(d, T);
    answerCard(db, a, true, NOW, T);
    expect(dayRow(T)).toMatchObject({ reviewed: 1, cleared: 0 });
    answerCard(db, b, false, NOW + 1, T);
    expect(dayRow(T)).toMatchObject({ reviewed: 2, cleared: 1 });
  });

  it('cleared is sticky within a day', () => {
    const d = deck('A');
    const a = card(d, T);
    answerCard(db, a, true, NOW, T);
    card(d, T); // e.g. a later import
    const c = card(d, T);
    answerCard(db, c, true, NOW + 1, T);
    expect(dayRow(T)).toMatchObject({ reviewed: 2, cleared: 1 });
  });

  it('a deck with remind off does not block cleared', () => {
    const a = deck('A');
    const b = deck('B');
    const x = card(a, T);
    card(b, T);
    setRemind(db, b, false);
    expect(listDecks(db, T).find((dk) => dk.id === b)?.remind).toBe(false);
    answerCard(db, x, true, NOW, T);
    expect(dayRow(T)).toMatchObject({ cleared: 1 });
  });

  it('undo of the last answer decrements reviewed and un-clears today', () => {
    const tz = 0;
    const now = Date.now();
    const today = dayNumber(now, tz);
    const d = deck('A');
    const a = card(d, today);
    const r = answerCard(db, a, true, now, today);
    expect(dayRow(today)).toMatchObject({ reviewed: 1, cleared: 1 });
    undoReview(db, r.reviewId, tz);
    expect(dayRow(today)).toMatchObject({ reviewed: 0, cleared: 0 });
  });

  it('undo of a review from another day does not touch today', () => {
    const tz = 0;
    const today = dayNumber(Date.now(), tz);
    const d = deck('A');
    const a = card(d, today - 1);
    const r = answerCard(db, a, true, (today - 1) * DAY_MS + 1000, today - 1);
    expect(dayRow(today - 1)).toMatchObject({ reviewed: 1, cleared: 1 });
    undoReview(db, r.reviewId, tz);
    expect(dayRow(today - 1)).toMatchObject({ reviewed: 0, cleared: 1 });
    expect(dayRow(today)).toBeUndefined();
  });

  it('setRemind on an unknown id throws', () => {
    expect(() => setRemind(db, 999, false)).toThrow('Deck not found');
  });
});

describe('habitSummary', () => {
  const T = 20000;

  it('forecast matches brute force and writes planned', () => {
    const ids = [deck('Beta'), deck('alpha'), deck('Gamma'), deck('Off')];
    setRemind(db, ids[3], false);
    let s = 7;
    const rnd = (n: number) => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s % n;
    };
    const cards: { deckId: number; due: number }[] = [];
    for (let i = 0; i < 300; i++) {
      const deckId = ids[rnd(4)];
      const due = T - 5 + rnd(45);
      card(deckId, due);
      cards.push({ deckId, due });
    }
    const sum = habitSummary(db, T);
    expect(sum.today).toBe(T);
    expect(sum.forecast.map((f) => f.name)).toEqual(['alpha', 'Beta', 'Gamma']);
    const totals = new Array(31).fill(0);
    for (const f of sum.forecast) {
      expect(f.byDay).toHaveLength(31);
      for (let i = 0; i < 31; i++) {
        const want = cards.filter((c) => c.deckId === f.deckId && (i === 0 ? c.due <= T : c.due === T + i)).length;
        expect(f.byDay[i]).toBe(want);
        totals[i] += want;
      }
    }
    for (let i = 1; i <= 30; i++) expect(dayRow(T + i)?.planned).toBe(totals[i]);
    expect(dayRow(T)).toMatchObject({ planned: totals[0], cleared: 0 });
  });

  it('keeps today planned once set, and clears today when nothing is due', () => {
    const d = deck('A');
    const a = card(d, T);
    habitSummary(db, T);
    expect(dayRow(T)).toMatchObject({ planned: 1, cleared: 0 });
    answerCard(db, a, true, T * DAY_MS, T);
    const sum = habitSummary(db, T);
    expect(dayRow(T)).toMatchObject({ planned: 1, cleared: 1 });
    expect(sum.days.at(-1)).toEqual({ day: T, reviewed: 1, cleared: true, planned: 1 });
  });

  it('empty DB clears today and lists no decks', () => {
    const sum = habitSummary(db, T);
    expect(sum.forecast).toEqual([]);
    expect(sum.days).toEqual([{ day: T, reviewed: 0, cleared: true, planned: 0 }]);
  });

  it('secondsPerCard defaults to 8 with few reviews and uses the median otherwise', () => {
    const d = deck('A');
    const c = card(d, T);
    const ins = (t: number) => db.exec({
      sql: 'INSERT INTO reviews(card_id, reviewed_at, correct, prev_box, prev_due_day, new_box, new_due_day) VALUES (?, ?, 1, 1, 0, 2, 0)',
      bind: [c, t],
    });
    let t = T * DAY_MS;
    ins(t);
    for (const g of [5000, 6000, 7000]) ins((t += g));
    expect(habitSummary(db, T).secondsPerCard).toBe(8);
    // gaps 5, 6, 7, 12.3, 20 (the 500 s gap is ignored) -> median 7
    for (const g of [12_300, 20_000, 500_000]) ins((t += g));
    expect(habitSummary(db, T).secondsPerCard).toBe(7);
    ins((t += 1000));
    // gaps 1, 5, 6, 7, 12.3, 20 -> median (6 + 7) / 2
    expect(habitSummary(db, T).secondsPerCard).toBe(6.5);
  });

  it('days covers a year, ascending', () => {
    db.exec({ sql: 'INSERT INTO days(day, reviewed, cleared) VALUES (?, 3, 1), (?, 2, 1), (?, 1, 1)', bind: [T - 400, T - 365, T - 10] });
    const sum = habitSummary(db, T);
    expect(sum.days.map((r) => r.day)).toEqual([T - 365, T - 10, T]);
  });
});
