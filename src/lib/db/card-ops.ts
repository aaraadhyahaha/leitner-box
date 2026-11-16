import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { cardHash, validateCard } from '../import-parse';
import { CARD_COLS, num, splitTags, toCard } from './ops';
import { ftsQuery } from './fts';
import { recordUndo } from './habit-ops';
import { dayNumber } from '../leitner';
import type {
  BatchSummary, Card, CardInput, CardPage, CardQuery, CardSelection, DueCursor,
} from './types';

const C_COLS = CARD_COLS.split(', ').map((c) => `c.${c}`).join(', ');
const EXPORT_PAGE = 5000;

interface Where { sql: string; bind: SqlValue[]; fts: boolean }

function where(q: CardQuery): Where {
  const fts = ftsQuery(q.search);
  const bind: SqlValue[] = [];
  let sql: string;
  if (fts) {
    sql = 'FROM cards_fts JOIN cards c ON c.id = cards_fts.rowid WHERE cards_fts MATCH ? AND c.deck_id = ?';
    bind.push(fts, q.deckId);
  } else {
    sql = 'FROM cards c WHERE c.deck_id = ?';
    bind.push(q.deckId);
  }
  if (q.box !== null) {
    sql += ' AND c.box = ?';
    bind.push(q.box);
  }
  return { sql, bind, fts: fts !== null };
}

function emptyBatchCleanup(db: Database): void {
  db.exec('DELETE FROM batches WHERE NOT EXISTS (SELECT 1 FROM cards WHERE batch_id = batches.id)');
}

function getCard(db: Database, id: number): Card {
  const row = db.selectArrays(`SELECT ${CARD_COLS} FROM cards WHERE id = ?`, [id])[0];
  if (!row) throw new Error('Card not found');
  return toCard(row);
}

export function listCards(db: Database, q: CardQuery, after: DueCursor | null, limit: number): CardPage {
  const w = where(q);
  let sql = `SELECT ${C_COLS} ${w.sql}`;
  const bind = [...w.bind];
  if (w.fts) {
    // Constrain and order by the FTS rowid (= c.id) so FTS5 streams matches in order
    // instead of SQLite sorting every match in a temp B-tree.
    if (after) {
      sql += ' AND cards_fts.rowid > ?';
      bind.push(after.id);
    }
    sql += ' ORDER BY cards_fts.rowid LIMIT ?';
  } else {
    if (after) {
      sql += ' AND (c.due_day, c.id) > (?, ?)';
      bind.push(after.dueDay, after.id);
    }
    sql += ' ORDER BY c.due_day, c.id LIMIT ?';
  }
  bind.push(limit);
  const cards = db.selectArrays(sql, bind).map(toCard);
  const last = cards[cards.length - 1];
  return { cards, next: last && cards.length === limit ? { dueDay: last.dueDay, id: last.id } : null };
}

export function countCards(db: Database, q: CardQuery): number {
  const w = where(q);
  return num(db.selectValue(`SELECT COUNT(*) ${w.sql}`, w.bind));
}

export function deleteCards(db: Database, sel: CardSelection): number {
  return db.transaction(() => {
    if ('ids' in sel) {
      db.exec({
        sql: 'DELETE FROM cards WHERE id IN (SELECT value FROM json_each(?))',
        bind: [JSON.stringify(sel.ids)],
      });
    } else {
      const w = where(sel.query);
      db.exec({
        sql: `DELETE FROM cards WHERE id IN (SELECT c.id ${w.sql}) AND id NOT IN (SELECT value FROM json_each(?))`,
        bind: [...w.bind, JSON.stringify(sel.exceptIds)],
      });
    }
    const deleted = db.changes();
    emptyBatchCleanup(db);
    return deleted;
  });
}

function checkInput(db: Database, input: CardInput, selfId: number): { front: string; back: string; tags: string; hash: string } {
  const v = validateCard({ front: input.front, back: input.back, tags: input.tags });
  if (!v.ok) throw new Error(v.message);
  if (db.selectValue('SELECT 1 FROM decks WHERE id = ?', [input.deckId]) === undefined) {
    throw new Error('Deck not found');
  }
  const { front, back } = v.card;
  const hash = cardHash(front, back);
  const dup = db.selectValue(
    'SELECT 1 FROM cards WHERE deck_id = ? AND hash = ? AND id <> ?', [input.deckId, hash, selfId],
  );
  if (dup !== undefined) throw new Error('Duplicate card');
  return { front, back, tags: v.card.tags.join(' '), hash };
}

export function createCard(db: Database, input: CardInput, now: number, today: number): Card {
  return db.transaction(() => {
    const c = checkInput(db, input, -1);
    db.exec({
      sql: `INSERT INTO cards(deck_id, batch_id, front, back, tags, hash, box, due_day, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, 1, ?, ?, ?)`,
      bind: [input.deckId, c.front, c.back, c.tags, c.hash, today, now, now],
    });
    return getCard(db, num(db.selectValue('SELECT last_insert_rowid()')));
  });
}

export function updateCard(db: Database, input: CardInput & { id: number }, now: number): Card {
  return db.transaction(() => {
    if (db.selectValue('SELECT 1 FROM cards WHERE id = ?', [input.id]) === undefined) {
      throw new Error('Card not found');
    }
    const c = checkInput(db, input, input.id);
    db.exec({
      sql: 'UPDATE cards SET deck_id = ?, front = ?, back = ?, tags = ?, hash = ?, updated_at = ? WHERE id = ?',
      bind: [input.deckId, c.front, c.back, c.tags, c.hash, now, input.id],
    });
    return getCard(db, input.id);
  });
}

function deckName(db: Database, name: string, selfId: number): string {
  const n = name.trim();
  if (n === '') throw new Error('Deck name is empty');
  if (db.selectValue('SELECT 1 FROM decks WHERE name = ? AND id <> ?', [n, selfId]) !== undefined) {
    throw new Error('Deck already exists');
  }
  return n;
}

export function createDeck(db: Database, name: string, now: number): number {
  const n = deckName(db, name, -1);
  db.exec({ sql: 'INSERT INTO decks(name, created_at) VALUES (?, ?)', bind: [n, now] });
  return num(db.selectValue('SELECT last_insert_rowid()'));
}

export function renameDeck(db: Database, id: number, name: string): void {
  const n = deckName(db, name, id);
  db.exec({ sql: 'UPDATE decks SET name = ? WHERE id = ?', bind: [n, id] });
  if (db.changes() === 0) throw new Error('Deck not found');
}

export function deleteDeck(db: Database, id: number): number {
  return db.transaction(() => {
    db.exec({ sql: 'DELETE FROM cards WHERE deck_id = ?', bind: [id] });
    const deleted = db.changes();
    db.exec({ sql: 'DELETE FROM decks WHERE id = ?', bind: [id] });
    emptyBatchCleanup(db);
    return deleted;
  });
}

export function listBatches(db: Database): BatchSummary[] {
  const rows = db.selectArrays(
    `SELECT b.id, b.source, b.created_at, COUNT(c.id), COUNT(DISTINCT c.deck_id), MIN(d.name)
       FROM batches b JOIN cards c ON c.batch_id = b.id JOIN decks d ON d.id = c.deck_id
      GROUP BY b.id ORDER BY b.id DESC`,
  );
  return rows.map(([id, source, createdAt, cardCount, deckCount, name]) => ({
    id: num(id),
    source: String(source),
    createdAt: num(createdAt),
    cardCount: num(cardCount),
    deckCount: num(deckCount),
    deckName: String(name),
  }));
}

export function deleteBatch(db: Database, id: number): number {
  return db.transaction(() => {
    db.exec({ sql: 'DELETE FROM cards WHERE batch_id = ?', bind: [id] });
    const deleted = db.changes();
    db.exec({ sql: 'DELETE FROM batches WHERE id = ?', bind: [id] });
    return deleted;
  });
}

export function undoReview(
  db: Database, reviewId: number, tzOffsetMin = new Date().getTimezoneOffset(),
): Card {
  return db.transaction(() => {
    const row = db.selectArrays(
      'SELECT card_id, prev_box, prev_due_day, reviewed_at FROM reviews WHERE id = ?', [reviewId],
    )[0];
    if (!row) throw new Error('Review not found');
    const cardId = num(row[0]);
    if (db.selectValue('SELECT 1 FROM reviews WHERE card_id = ? AND id > ?', [cardId, reviewId]) !== undefined) {
      throw new Error('Cannot undo');
    }
    db.exec({
      sql: 'UPDATE cards SET box = ?, due_day = ? WHERE id = ?',
      bind: [num(row[1]), num(row[2]), cardId],
    });
    db.exec({ sql: 'DELETE FROM reviews WHERE id = ?', bind: [reviewId] });
    recordUndo(db, num(row[3]), dayNumber(Date.now(), tzOffsetMin), tzOffsetMin);
    return getCard(db, cardId);
  });
}

export function exportJsonl(db: Database, deckId: number | null): Blob {
  const parts: string[] = [];
  const base = `SELECT c.id, d.name, c.front, c.back, c.tags
                  FROM cards c JOIN decks d ON d.id = c.deck_id
                 WHERE c.id > ?${deckId === null ? '' : ' AND c.deck_id = ?'}
                 ORDER BY c.id LIMIT ${EXPORT_PAGE}`;
  let after = 0;
  for (;;) {
    const rows = db.selectArrays(base, deckId === null ? [after] : [after, deckId]);
    for (const [id, deck, front, back, tags] of rows) {
      after = num(id);
      parts.push(JSON.stringify({ deck: String(deck), front: String(front), back: String(back), tags: splitTags(tags ?? null) }) + '\n');
    }
    if (rows.length < EXPORT_PAGE) break;
  }
  return new Blob(parts, { type: 'application/x-ndjson' });
}
