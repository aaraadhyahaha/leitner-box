export const SCHEMA_V1 = `
CREATE TABLE decks(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL);
CREATE TABLE batches(
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  card_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE cards(
  id INTEGER PRIMARY KEY,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
  front TEXT NOT NULL, back TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',          -- space-separated
  hash TEXT NOT NULL,
  box INTEGER NOT NULL DEFAULT 1 CHECK(box BETWEEN 1 AND 5),
  due_day INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(deck_id, hash));
CREATE INDEX cards_deck_due ON cards(deck_id, due_day);
CREATE INDEX cards_deck_box ON cards(deck_id, box, due_day);
CREATE INDEX cards_batch ON cards(batch_id);
CREATE TABLE reviews(
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  reviewed_at INTEGER NOT NULL, correct INTEGER NOT NULL,
  prev_box INTEGER NOT NULL, prev_due_day INTEGER NOT NULL,
  new_box INTEGER NOT NULL, new_due_day INTEGER NOT NULL);
CREATE INDEX reviews_card ON reviews(card_id);
CREATE VIRTUAL TABLE cards_fts USING fts5(
  front, back, tags, content='cards', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER cards_ai AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts(rowid, front, back, tags) VALUES (new.id, new.front, new.back, new.tags);
END;
CREATE TRIGGER cards_ad AFTER DELETE ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, front, back, tags) VALUES ('delete', old.id, old.front, old.back, old.tags);
END;
CREATE TRIGGER cards_au AFTER UPDATE OF front, back, tags ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, front, back, tags) VALUES ('delete', old.id, old.front, old.back, old.tags);
  INSERT INTO cards_fts(rowid, front, back, tags) VALUES (new.id, new.front, new.back, new.tags);
END;
PRAGMA user_version = 1;
`;
