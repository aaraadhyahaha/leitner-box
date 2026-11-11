import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { readCards } from '../import-parse';
import { answerCard, migrate, runImport } from './ops';
import {
  countCards, createCard, createDeck, deleteBatch, deleteCards, deleteDeck, exportJsonl,
  listBatches, listCards, renameDeck, undoReview, updateCard,
} from './card-ops';
import type { Card, CardQuery } from './types';

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

function importInto(target: Database, text: string | Blob) {
  return runImport(target, readCards(typeof text === 'string' ? new Blob([text]) : text), {
    defaultDeck: 'Default', source: 'test.jsonl', commit: true, now: NOW, today: TODAY,
  });
}
const importText = (text: string | Blob) => importInto(db, text);

const count = (sql: string) => Number(db.selectValue(sql));
const deckId = (name: string) => count(`SELECT id FROM decks WHERE name = '${name}'`);

function listAll(q: CardQuery, limit: number): Card[][] {
  const pages: Card[][] = [];
  let after = null;
  for (;;) {
    const p = listCards(db, q, after, limit);
    pages.push(p.cards);
    if (!p.next) break;
    after = p.next;
  }
  return pages;
}

describe('listCards / countCards', () => {
  it('pages through 450 cards in pages of 200 without repeats', async () => {
    await importText(jsonl(Array.from({ length: 450 }, (_, i) => ({ deck: 'D', front: `f${i}`, back: `b${i}` }))));
    const q = { deckId: deckId('D'), search: '', box: null };
    const pages = listAll(q, 200);
    expect(pages.map((p) => p.length)).toEqual([200, 200, 50]);
    const ids = pages.flat().map((c) => c.id);
    expect(new Set(ids).size).toBe(450);
    expect(listCards(db, q, null, 450).next).toEqual({ dueDay: TODAY, id: Math.max(...ids) });
    expect(listCards(db, q, null, 451).next).toBeNull();
  });

  it('filters by box and searches by prefix and two terms; count matches list', async () => {
    await importText(jsonl([
      { deck: 'D', front: 'mitochondria', back: 'powerhouse of the cell', tags: ['bio'] },
      { deck: 'D', front: 'ribosome', back: 'protein factory', tags: ['bio'] },
      { deck: 'D', front: 'benzene', back: 'aromatic ring', tags: ['chem'] },
      { deck: 'D', front: 'cell wall', back: 'plant cells' },
      { deck: 'Other', front: 'mitochondria', back: 'elsewhere' },
    ]));
    const d = deckId('D');
    const benz = count("SELECT id FROM cards WHERE front = 'benzene'");
    const ribo = count("SELECT id FROM cards WHERE front = 'ribosome'");
    answerCard(db, benz, true, NOW, TODAY);
    answerCard(db, ribo, true, NOW, TODAY);

    const fronts = (q: CardQuery) => listAll(q, 2).flat().map((c) => c.front).sort();
    const shapes: [CardQuery, string[]][] = [
      [{ deckId: d, search: '', box: null }, ['benzene', 'cell wall', 'mitochondria', 'ribosome']],
      [{ deckId: d, search: '', box: 2 }, ['benzene', 'ribosome']],
      [{ deckId: d, search: '', box: 1 }, ['cell wall', 'mitochondria']],
      [{ deckId: d, search: 'mito', box: null }, ['mitochondria']],
      [{ deckId: d, search: 'cell', box: null }, ['cell wall', 'mitochondria']],
      [{ deckId: d, search: 'plant cell', box: null }, ['cell wall']],
      [{ deckId: d, search: 'bio', box: 2 }, ['ribosome']],
      [{ deckId: d, search: 'nothing', box: null }, []],
      [{ deckId: d, search: '"--"', box: 2 }, ['benzene', 'ribosome']],
    ];
    for (const [q, expected] of shapes) {
      expect(fronts(q), JSON.stringify(q)).toEqual(expected);
      expect(countCards(db, q), JSON.stringify(q)).toBe(expected.length);
    }
  });
});

describe('deleteCards', () => {
  it('deletes by ids and by query with exceptIds; emptied batches disappear', async () => {
    const b1 = await importText(jsonl([{ deck: 'D', front: 'a', back: '1' }, { deck: 'D', front: 'b', back: '2' }]));
    await importText(jsonl([
      { deck: 'D', front: 'apple', back: 'x' }, { deck: 'D', front: 'apricot', back: 'y' },
      { deck: 'D', front: 'banana', back: 'z' },
    ]));
    expect(listBatches(db)).toHaveLength(2);
    const id = (f: string) => count(`SELECT id FROM cards WHERE front = '${f}'`);

    expect(deleteCards(db, { ids: [id('a'), id('b')] })).toBe(2);
    const batches = listBatches(db);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.id).not.toBe(b1.batchId);

    const q = { deckId: deckId('D'), search: 'ap', box: null };
    expect(deleteCards(db, { query: q, exceptIds: [id('apricot')] })).toBe(1);
    expect(db.selectValues('SELECT front FROM cards ORDER BY front')).toEqual(['apricot', 'banana']);
    expect(listBatches(db)[0]).toMatchObject({ cardCount: 2, deckCount: 1, deckName: 'D' });

    expect(deleteCards(db, { query: { deckId: deckId('D'), search: '', box: null }, exceptIds: [] })).toBe(2);
    expect(listBatches(db)).toEqual([]);
    expect(count('SELECT COUNT(*) FROM batches')).toBe(0);
  });
});

describe('createCard / updateCard', () => {
  it('creates, updates, rejects duplicates and invalid input, and moves decks', () => {
    const a = createDeck(db, 'A', NOW);
    const b = createDeck(db, 'B', NOW);
    const c = createCard(db, { deckId: a, front: ' q ', back: 'r', tags: ['t1', 't2'] }, NOW, TODAY);
    expect(c).toMatchObject({ deckId: a, batchId: null, front: 'q', back: 'r', tags: ['t1', 't2'], box: 1, dueDay: TODAY });

    expect(() => createCard(db, { deckId: a, front: 'q', back: 'r', tags: [] }, NOW, TODAY)).toThrow('Duplicate card');
    expect(() => createCard(db, { deckId: a, front: '  ', back: 'r', tags: [] }, NOW, TODAY)).toThrow('Missing front');
    expect(() => createCard(db, { deckId: 999, front: 'x', back: 'y', tags: [] }, NOW, TODAY)).toThrow('Deck not found');

    answerCard(db, c.id, true, NOW, TODAY);
    const u = updateCard(db, { id: c.id, deckId: a, front: 'q2', back: 'r', tags: [] }, NOW + 5);
    expect(u).toMatchObject({ front: 'q2', tags: [], box: 2, dueDay: TODAY + 2 });
    expect(updateCard(db, { id: c.id, deckId: a, front: 'q2', back: 'r', tags: ['x'] }, NOW).tags).toEqual(['x']);
    expect(count('SELECT updated_at FROM cards')).toBe(NOW);
    expect(db.selectValue("SELECT COUNT(*) FROM cards_fts WHERE cards_fts MATCH 'q2'")).toBe(1);

    const other = createCard(db, { deckId: a, front: 'o', back: 'p', tags: [] }, NOW, TODAY);
    expect(() => updateCard(db, { id: other.id, deckId: a, front: 'q2', back: 'r', tags: [] }, NOW)).toThrow('Duplicate card');
    expect(() => updateCard(db, { id: 999, deckId: a, front: 'z', back: 'z', tags: [] }, NOW)).toThrow('Card not found');

    const moved = updateCard(db, { id: c.id, deckId: b, front: 'q2', back: 'r', tags: [] }, NOW);
    expect(moved).toMatchObject({ deckId: b, box: 2 });
    expect(countCards(db, { deckId: a, search: '', box: null })).toBe(1);
    expect(countCards(db, { deckId: b, search: '', box: null })).toBe(1);
  });
});

describe('createDeck / renameDeck / deleteDeck', () => {
  it('validates names', () => {
    const a = createDeck(db, '  Bio ', NOW);
    expect(db.selectValue('SELECT name FROM decks WHERE id = ?', [a])).toBe('Bio');
    expect(() => createDeck(db, '   ', NOW)).toThrow('Deck name is empty');
    expect(() => createDeck(db, 'bio', NOW)).toThrow('Deck already exists');
    const b = createDeck(db, 'Chem', NOW);
    expect(() => renameDeck(db, b, 'BIO')).toThrow('Deck already exists');
    expect(() => renameDeck(db, b, '')).toThrow('Deck name is empty');
    renameDeck(db, a, 'BIO');
    expect(db.selectValue('SELECT name FROM decks WHERE id = ?', [a])).toBe('BIO');
  });

  it('deleteDeck removes its cards and FTS rows', async () => {
    await importText(jsonl([
      { deck: 'Gone', front: 'zebra', back: 'stripes' }, { deck: 'Gone', front: 'yak', back: 'hair' },
      { deck: 'Kept', front: 'lion', back: 'mane' },
    ]));
    expect(deleteDeck(db, deckId('Gone'))).toBe(2);
    expect(count("SELECT COUNT(*) FROM decks WHERE name = 'Gone'")).toBe(0);
    expect(count("SELECT COUNT(*) FROM cards_fts WHERE cards_fts MATCH 'zebra OR yak'")).toBe(0);
    expect(count("SELECT COUNT(*) FROM cards_fts WHERE cards_fts MATCH 'lion'")).toBe(1);
    expect(listBatches(db)).toHaveLength(1);
  });
});

describe('batches', () => {
  it('lists and deletes a batch', async () => {
    const r = await importText(jsonl([
      { deck: 'Z', front: 'a', back: 'b' }, { deck: 'M', front: 'c', back: 'd' },
    ]));
    await importText(jsonl([{ deck: 'M', front: 'e', back: 'f' }]));
    const list = listBatches(db);
    expect(list).toHaveLength(2);
    expect(list[1]).toEqual({
      id: r.batchId, source: 'test.jsonl', createdAt: NOW, cardCount: 2, deckCount: 2, deckName: 'M',
    });
    expect(deleteBatch(db, r.batchId!)).toBe(2);
    expect(listBatches(db).map((b) => b.id)).not.toContain(r.batchId);
    expect(count('SELECT COUNT(*) FROM cards')).toBe(1);
  });
});

describe('undoReview', () => {
  it('restores box and due day, removes the review, and refuses older reviews', async () => {
    await importText(jsonl([{ front: 'a', back: 'b' }]));
    const id = count('SELECT id FROM cards');
    const r1 = answerCard(db, id, true, NOW, TODAY);
    const r2 = answerCard(db, id, true, NOW, TODAY);
    expect(() => undoReview(db, r1.reviewId)).toThrow('Cannot undo');
    const c = undoReview(db, r2.reviewId);
    expect(c).toMatchObject({ id, box: 2, dueDay: r1.dueDay });
    expect(count('SELECT COUNT(*) FROM reviews')).toBe(1);
    expect(undoReview(db, r1.reviewId)).toMatchObject({ box: 1, dueDay: TODAY });
    expect(count('SELECT COUNT(*) FROM reviews')).toBe(0);
    expect(() => undoReview(db, r1.reviewId)).toThrow('Review not found');
  });
});

describe('exportJsonl', () => {
  it('round-trips three decks and re-imports into the same DB as no-ops', async () => {
    await importText(jsonl([
      { deck: 'A', front: '$\\frac{1}{2}$', back: 'half', tags: ['math', 'frac'] },
      { deck: 'A', front: 'quote "x"', back: 'line\nbreak' },
      { deck: 'B', front: '\\ce{H2O}', back: 'water', tags: ['chem'] },
      { deck: 'C', front: '{{smiles:CCO|ethanol}}', back: 'ethanol' },
    ]));
    const set = (target: Database) => target.selectArrays(
      `SELECT d.name, c.front, c.back, c.tags FROM cards c JOIN decks d ON d.id = c.deck_id
        ORDER BY d.name, c.front`,
    );
    const blob = exportJsonl(db, null);
    expect(blob.type).toBe('application/x-ndjson');
    const lines = (await blob.text()).trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]!)).toEqual({ deck: 'A', front: '$\\frac{1}{2}$', back: 'half', tags: ['math', 'frac'] });

    const fresh = new sqlite3.oo1.DB(':memory:');
    try {
      migrate(fresh);
      const r = await importInto(fresh, blob);
      expect(r).toMatchObject({ added: 4, errorCount: 0 });
      expect(set(fresh)).toEqual(set(db));
    } finally {
      fresh.close();
    }

    const again = await importText(blob);
    expect(again).toMatchObject({ added: 0, duplicates: 4 });

    const onlyB = (await exportJsonl(db, deckId('B')).text()).trim().split('\n');
    expect(onlyB.map((l) => JSON.parse(l).deck)).toEqual(['B']);
  });
});
