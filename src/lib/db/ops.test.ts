import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { readCards } from '../import-parse';
import { answerCard, dueCards, listDecks, migrate, runImport } from './ops';

const TODAY = 20000;
const NOW = 1_700_000_000_000;

let sqlite3: Sqlite3Static;
let db: Database;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

beforeEach(() => {
  db = new sqlite3.oo1.DB(':memory:');
  migrate(db);
});

afterEach(() => {
  db.close();
});

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

function importText(text: string, opts: Partial<{ defaultDeck: string; commit: boolean }> = {}) {
  return runImport(db, readCards(new Blob([text])), {
    defaultDeck: opts.defaultDeck ?? 'Default',
    source: 'test.jsonl',
    commit: opts.commit ?? true,
    now: NOW,
    today: TODAY,
  });
}

const count = (sql: string) => Number(db.selectValue(sql));

describe('migrate', () => {
  it('is safe to run twice', () => {
    expect(() => migrate(db)).not.toThrow();
    expect(count('PRAGMA user_version')).toBe(2);
    expect(count('SELECT COUNT(*) FROM decks')).toBe(0);
  });
});

describe('runImport', () => {
  it('counts added, duplicates and errors with lines', async () => {
    const text = [
      JSON.stringify({ front: 'a', back: 'b' }),
      '{bad json',
      JSON.stringify({ front: 'a', back: 'b' }),
      JSON.stringify({ front: 'c' }),
      JSON.stringify({ deck: 'Chem', front: 'x', back: 'y', tags: ['t1', 't2'] }),
    ].join('\n');
    const r = await importText(text);
    expect(r.committed).toBe(true);
    expect(r.added).toBe(2);
    expect(r.duplicates).toBe(1);
    expect(r.errorCount).toBe(2);
    expect(r.errors.map((e) => e.line)).toEqual([2, 4]);
    expect(r.batchId).not.toBeNull();
    expect(r.decks).toEqual([{ name: 'Default', added: 1, isNew: true }, { name: 'Chem', added: 1, isNew: true }]);
    expect(count('SELECT COUNT(*) FROM cards')).toBe(2);
    expect(count(`SELECT card_count FROM batches WHERE id = ${r.batchId}`)).toBe(2);
    expect(db.selectValue("SELECT tags FROM cards WHERE front = 'x'")).toBe('t1 t2');
  });

  it('re-importing the same text adds nothing and leaves one batch', async () => {
    const text = jsonl([{ front: 'a', back: 'b' }, { front: 'c', back: 'd' }]);
    const first = await importText(text);
    expect(first.added).toBe(2);
    const second = await importText(text);
    expect(second.added).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(second.batchId).toBeNull();
    expect(count('SELECT COUNT(*) FROM batches')).toBe(1);
    expect(count('SELECT COUNT(*) FROM cards')).toBe(2);
  });

  it('commit: false leaves tables empty but reports the same counts', async () => {
    const text = jsonl([{ front: 'a', back: 'b' }, { front: 'a', back: 'b' }, { front: 'q' }]);
    const r = await importText(text, { commit: false });
    expect(r.committed).toBe(false);
    expect(r.batchId).toBeNull();
    expect(r).toMatchObject({ added: 1, duplicates: 1, errorCount: 1 });
    expect(count('SELECT COUNT(*) FROM cards')).toBe(0);
    expect(count('SELECT COUNT(*) FROM decks')).toBe(0);
    expect(count('SELECT COUNT(*) FROM batches')).toBe(0);
  });

  it('matches deck names case-insensitively', async () => {
    const r = await importText(jsonl([
      { deck: 'Bio', front: 'a', back: 'b' },
      { deck: 'bio', front: 'c', back: 'd' },
    ]));
    expect(count('SELECT COUNT(*) FROM decks')).toBe(1);
    expect(r.decks).toEqual([{ name: 'Bio', added: 2, isNew: true }]);
  });

  it('falls back to Imported when the default deck is blank', async () => {
    const r = await importText(jsonl([{ front: 'a', back: 'b' }]), { defaultDeck: '  ' });
    expect(r.decks).toEqual([{ name: 'Imported', added: 1, isNew: true }]);
  });

  it('reports isNew true on first import and false on the second', async () => {
    const first = await importText(jsonl([{ deck: 'N', front: 'a', back: 'b' }]));
    expect(first.decks).toEqual([{ name: 'N', added: 1, isNew: true }]);
    const second = await importText(jsonl([{ deck: 'n', front: 'c', back: 'd' }]));
    expect(second.decks).toEqual([{ name: 'N', added: 1, isNew: false }]);
  });

  it('returns a sample of at most 20 added cards with line numbers', async () => {
    const rows = [{ front: 'dup', back: 'x' }, { front: 'dup', back: 'x' }, { front: 'bad' },
      ...Array.from({ length: 30 }, (_, i) => ({ front: `f${i}`, back: `b${i}` }))];
    const r = await importText(jsonl(rows));
    expect(r.added).toBe(31);
    expect(r.sample).toHaveLength(20);
    expect(r.sample[0]).toEqual({ line: 1, front: 'dup', back: 'x' });
    expect(r.sample[1]).toEqual({ line: 4, front: 'f0', back: 'b0' });
    expect(r.sample[19]).toEqual({ line: 22, front: 'f18', back: 'b18' });
    const small = await importText(jsonl([{ front: 'only', back: 'one' }]));
    expect(small.sample).toEqual([{ line: 1, front: 'only', back: 'one' }]);
  });

  it('indexes imported cards for FTS', async () => {
    await importText(jsonl([{ front: 'mitochondria', back: 'powerhouse' }, { front: 'x', back: 'y' }]));
    const rows = db.selectArrays(
      "SELECT c.front FROM cards_fts f JOIN cards c ON c.id = f.rowid WHERE cards_fts MATCH 'powerhouse'",
    );
    expect(rows).toEqual([['mitochondria']]);
  });

  it('keeps the FTS insert trigger after a commit, a preview and a re-import', async () => {
    const trigger = () => db.selectValue("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'cards_ai'");
    await importText(jsonl([{ front: 'a', back: 'b' }]), { commit: false });
    expect(trigger()).toBe(1);
    await importText(jsonl([{ front: 'a', back: 'b' }]));
    await importText(jsonl([{ front: 'a', back: 'b' }, { front: 'c', back: 'quasar' }]));
    expect(trigger()).toBe(1);
    // Only the new card was indexed by the second import; no duplicate FTS rows.
    expect(db.selectValue("SELECT count(*) FROM cards_fts WHERE cards_fts MATCH 'b'")).toBe(1);
    expect(db.selectValue("SELECT count(*) FROM cards_fts WHERE cards_fts MATCH 'quasar'")).toBe(1);
    // Cards inserted outside an import are still indexed by the trigger.
    db.exec("INSERT INTO cards(deck_id, front, back, tags, hash, due_day, created_at, updated_at) VALUES (1, 'n', 'nebula', '', 'h1', 0, 0, 0)");
    expect(db.selectValue("SELECT count(*) FROM cards_fts WHERE cards_fts MATCH 'nebula'")).toBe(1);
  });
});

describe('listDecks', () => {
  it('reports box and due counts', async () => {
    await importText(jsonl([
      { deck: 'A', front: '1', back: '1' },
      { deck: 'A', front: '2', back: '2' },
      { deck: 'A', front: '3', back: '3' },
    ]));
    db.exec({ sql: 'INSERT INTO decks(name, created_at) VALUES (?, ?)', bind: ['empty', NOW] });
    const id = count("SELECT id FROM cards WHERE front = '1'");
    // box 1 -> 2 -> 3, each with a future due day
    answerCard(db, id, true, NOW, TODAY);
    const r = answerCard(db, id, true, NOW, TODAY);
    expect(r.box).toBe(3);
    expect(r.dueDay).toBeGreaterThan(TODAY);

    const decks = listDecks(db, TODAY);
    expect(decks.map((d) => d.name)).toEqual(['A', 'empty']);
    expect(decks[0]).toMatchObject({ total: 3, due: 2, boxes: [2, 0, 1, 0, 0] });
    expect(decks[1]).toMatchObject({ total: 0, due: 0, boxes: [0, 0, 0, 0, 0] });
  });
});

describe('dueCards', () => {
  it('pages with a keyset cursor without overlaps', async () => {
    await importText(jsonl([1, 2, 3, 4, 5].map((n) => ({ deck: 'D', front: `f${n}`, back: `b${n}`, tags: ['x'] }))));
    const deckId = count("SELECT id FROM decks WHERE name = 'D'");
    const p1 = dueCards(db, deckId, TODAY, null, 2);
    const last1 = p1[p1.length - 1]!;
    const p2 = dueCards(db, deckId, TODAY, { dueDay: last1.dueDay, id: last1.id }, 2);
    const last2 = p2[p2.length - 1]!;
    const p3 = dueCards(db, deckId, TODAY, { dueDay: last2.dueDay, id: last2.id }, 2);
    expect([p1.length, p2.length, p3.length]).toEqual([2, 2, 1]);
    const ids = [...p1, ...p2, ...p3].map((c) => c.id);
    expect(new Set(ids).size).toBe(5);
    expect(p1[0]).toMatchObject({ deckId, box: 1, dueDay: TODAY, tags: ['x'], front: 'f1' });
    expect(p1[0]!.batchId).not.toBeNull();
  });

  it('excludes cards not yet due', async () => {
    await importText(jsonl([{ deck: 'D', front: 'a', back: 'b' }]));
    const deckId = count("SELECT id FROM decks WHERE name = 'D'");
    const id = count('SELECT id FROM cards');
    answerCard(db, id, true, NOW, TODAY);
    expect(dueCards(db, deckId, TODAY, null, 10)).toEqual([]);
  });
});

describe('answerCard', () => {
  it('moves up on right and back to box 1 on wrong, logging reviews', async () => {
    await importText(jsonl([{ front: 'a', back: 'b' }]));
    const id = count('SELECT id FROM cards');
    const right = answerCard(db, id, true, NOW, TODAY);
    expect(right.box).toBe(2);
    const wrong = answerCard(db, id, false, NOW + 1, TODAY);
    expect(wrong.box).toBe(1);
    expect(wrong.reviewId).toBeGreaterThan(right.reviewId);
    const rows = db.selectObjects('SELECT * FROM reviews ORDER BY id');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: right.reviewId, card_id: id, correct: 1, prev_box: 1, prev_due_day: TODAY,
      new_box: 2, new_due_day: right.dueDay,
    });
    expect(rows[1]).toMatchObject({ correct: 0, prev_box: 2, new_box: 1, new_due_day: wrong.dueDay });
    expect(db.selectArrays('SELECT box, due_day, updated_at FROM cards')).toEqual([[1, wrong.dueDay, NOW + 1]]);
  });

  it('throws for a missing card', () => {
    expect(() => answerCard(db, 999, true, NOW, TODAY)).toThrow('Card not found');
  });
});
