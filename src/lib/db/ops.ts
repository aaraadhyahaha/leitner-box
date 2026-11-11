import type { Database, PreparedStatement, SqlValue } from '@sqlite.org/sqlite-wasm';
import { review } from '../leitner';
import { cardHash, type ParsedLine } from '../import-parse';
import { SCHEMA_V1 } from './schema';
import type {
  AnswerResult, Box, Card, DeckSummary, DueCursor, ImportError, ImportResult, ImportSample,
} from './types';

const MAX_ERRORS = 100;
const MAX_SAMPLE = 20;

export function num(v: SqlValue | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return 0;
}

export function splitTags(s: SqlValue): string[] {
  return typeof s === 'string' ? s.split(' ').filter((t) => t !== '') : [];
}

export const CARD_COLS = 'id, deck_id, batch_id, front, back, tags, box, due_day';

export function toCard(row: SqlValue[]): Card {
  const [id, dId, bId, front, back, tags, box, dueDay] = row;
  return {
    id: num(id),
    deckId: num(dId),
    batchId: bId === null || bId === undefined ? null : num(bId),
    front: String(front),
    back: String(back),
    tags: splitTags(tags ?? null),
    box: num(box) as Box,
    dueDay: num(dueDay),
  };
}

export function migrate(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON');
  const version = num(db.selectValue('PRAGMA user_version'));
  if (version === 0) {
    db.transaction(() => {
      db.exec(SCHEMA_V1);
    });
  }
}

export function listDecks(db: Database, today: number): DeckSummary[] {
  const rows = db.selectArrays(
    `SELECT d.id, d.name, c.box, COUNT(c.id), SUM(c.due_day <= ?)
       FROM decks d LEFT JOIN cards c ON c.deck_id = d.id
      GROUP BY d.id, c.box
      ORDER BY d.name COLLATE NOCASE, d.id`,
    [today],
  );
  const out: DeckSummary[] = [];
  let cur: DeckSummary | null = null;
  for (const [id, name, box, count, due] of rows) {
    const deckId = num(id);
    if (!cur || cur.id !== deckId) {
      cur = { id: deckId, name: String(name), total: 0, due: 0, boxes: [0, 0, 0, 0, 0] };
      out.push(cur);
    }
    if (box === null) continue;
    const b = num(box);
    const n = num(count);
    if (b >= 1 && b <= 5) cur.boxes[b - 1] = n;
    cur.total += n;
    cur.due += num(due);
  }
  return out;
}

export async function runImport(
  db: Database,
  cards: AsyncIterable<ParsedLine>,
  opts: { defaultDeck: string; source: string; commit: boolean; now: number; today: number },
): Promise<ImportResult> {
  const fallbackDeck = opts.defaultDeck.trim() || 'Imported';
  let added = 0;
  let duplicates = 0;
  let errorCount = 0;
  const errors: ImportError[] = [];
  const sample: ImportSample[] = [];
  const deckIds = new Map<string, { id: number; name: string; added: number; isNew: boolean }>();

  const stmts: PreparedStatement[] = [];
  db.exec('BEGIN');
  try {
    db.exec({ sql: 'INSERT INTO batches(source, created_at) VALUES (?, ?)', bind: [opts.source, opts.now] });
    const batchId = num(db.selectValue('SELECT last_insert_rowid()'));

    const insDeck = db.prepare('INSERT INTO decks(name, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING');
    stmts.push(insDeck);
    const selDeck = db.prepare('SELECT id, name FROM decks WHERE name = ?');
    stmts.push(selDeck);
    const insCard = db.prepare(
      `INSERT INTO cards(deck_id, batch_id, front, back, tags, hash, box, due_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(deck_id, hash) DO NOTHING`,
    );
    stmts.push(insCard);

    const resolveDeck = (raw: string) => {
      const key = raw.toLowerCase();
      let d = deckIds.get(key);
      if (!d) {
        insDeck.bind([raw, opts.now]).step();
        const isNew = db.changes() > 0;
        insDeck.reset(true);
        selDeck.bind([raw]);
        if (!selDeck.step()) throw new Error(`Deck not found after insert: ${raw}`);
        d = { id: num(selDeck.get(0)), name: String(selDeck.get(1)), added: 0, isNew };
        selDeck.reset(true);
        deckIds.set(key, d);
      }
      return d;
    };

    for await (const item of cards) {
      if (!item.ok) {
        errorCount++;
        if (errors.length < MAX_ERRORS) errors.push({ line: item.line, message: item.message });
        continue;
      }
      const c = item.card;
      const deck = resolveDeck(c.deck?.trim() || fallbackDeck);
      insCard
        .bind([deck.id, batchId, c.front, c.back, c.tags.join(' '), cardHash(c.front, c.back),
          opts.today, opts.now, opts.now])
        .step();
      insCard.reset(true);
      if (db.changes() > 0) {
        added++;
        deck.added++;
        if (sample.length < MAX_SAMPLE) sample.push({ line: item.line, front: c.front, back: c.back });
      } else {
        duplicates++;
      }
    }

    if (added > 0) {
      db.exec({ sql: 'UPDATE batches SET card_count = ? WHERE id = ?', bind: [added, batchId] });
    } else {
      db.exec({ sql: 'DELETE FROM batches WHERE id = ?', bind: [batchId] });
    }

    db.exec(opts.commit ? 'COMMIT' : 'ROLLBACK');
    return {
      committed: opts.commit,
      batchId: opts.commit && added > 0 ? batchId : null,
      added, duplicates, errorCount, errors,
      decks: [...deckIds.values()].map((d) => ({ name: d.name, added: d.added, isNew: d.isNew })),
      sample,
    };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    for (const s of stmts) s.finalize();
  }
}

export function dueCards(
  db: Database, deckId: number, today: number, after: DueCursor | null, limit: number,
): Card[] {
  const base = `SELECT ${CARD_COLS} FROM cards WHERE deck_id = ? AND due_day <= ?`;
  const rows = after
    ? db.selectArrays(`${base} AND (due_day, id) > (?, ?) ORDER BY due_day, id LIMIT ?`,
      [deckId, today, after.dueDay, after.id, limit])
    : db.selectArrays(`${base} ORDER BY due_day, id LIMIT ?`, [deckId, today, limit]);
  return rows.map(toCard);
}

export function answerCard(
  db: Database, cardId: number, correct: boolean, now: number, today: number,
): AnswerResult {
  return db.transaction(() => {
    const row = db.selectArrays('SELECT box, due_day FROM cards WHERE id = ?', [cardId])[0];
    if (!row) throw new Error('Card not found');
    const prevBox = num(row[0]) as Box;
    const prevDue = num(row[1]);
    const next = review(prevBox, correct, today);
    db.exec({
      sql: 'UPDATE cards SET box = ?, due_day = ?, updated_at = ? WHERE id = ?',
      bind: [next.box, next.dueDay, now, cardId],
    });
    db.exec({
      sql: `INSERT INTO reviews(card_id, reviewed_at, correct, prev_box, prev_due_day, new_box, new_due_day)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bind: [cardId, now, correct ? 1 : 0, prevBox, prevDue, next.box, next.dueDay],
    });
    const reviewId = num(db.selectValue('SELECT last_insert_rowid()'));
    return { reviewId, box: next.box, dueDay: next.dueDay };
  });
}
