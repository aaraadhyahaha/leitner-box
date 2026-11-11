export type Box = 1 | 2 | 3 | 4 | 5;

export interface DeckSummary {
  id: number; name: string; total: number; due: number;
  boxes: [number, number, number, number, number]; // count in box 1..5
}
export interface Card {
  id: number; deckId: number; batchId: number | null;
  front: string; back: string; tags: string[];
  box: Box; dueDay: number;
}
export interface DueCursor { dueDay: number; id: number }
export interface ImportError { line: number; message: string }
export interface ImportSample { line: number; front: string; back: string }
export interface ImportResult {
  committed: boolean;
  batchId: number | null;            // null when nothing was added or commit=false
  added: number; duplicates: number;
  errorCount: number; errors: ImportError[]; // errors holds the first 100
  decks: { name: string; added: number; isNew: boolean }[];
  sample: ImportSample[];            // the first 20 added cards
}
export interface AnswerResult { reviewId: number; box: Box; dueDay: number }
export interface CardQuery { deckId: number; search: string; box: Box | null }
export interface CardPage { cards: Card[]; next: DueCursor | null }  // next is null on the last page
export type CardSelection = { ids: number[] } | { query: CardQuery; exceptIds: number[] };
export interface CardInput { deckId: number; front: string; back: string; tags: string[] }
export interface BatchSummary {
  id: number; source: string; createdAt: number;
  cardCount: number;                   // cards still alive
  deckCount: number; deckName: string; // deckName is the alphabetically first deck
}

export interface Api {
  'deck.list':    { req: null; res: DeckSummary[] };
  'import.run':   { req: { file: File; defaultDeck: string; commit: boolean }; res: ImportResult };
  'study.due':    { req: { deckId: number; after: DueCursor | null; limit: number }; res: Card[] };
  'study.answer': { req: { cardId: number; correct: boolean }; res: AnswerResult };
  'card.list':    { req: { query: CardQuery; after: DueCursor | null; limit: number }; res: CardPage };
  'card.count':   { req: CardQuery; res: number };
  'card.delete':  { req: CardSelection; res: { deleted: number } };
  'card.create':  { req: CardInput; res: Card };
  'card.update':  { req: CardInput & { id: number }; res: Card };
  'deck.create':  { req: { name: string }; res: { id: number } };
  'deck.rename':  { req: { id: number; name: string }; res: null };
  'deck.delete':  { req: { id: number }; res: { deleted: number } };
  'batch.list':   { req: null; res: BatchSummary[] };
  'batch.delete': { req: { id: number }; res: { deleted: number } };
  'study.undo':   { req: { reviewId: number }; res: Card };
  'export.jsonl': { req: { deckId: number | null }; res: Blob };
}
export type Op = keyof Api;
export interface WireRequest { id: number; op: Op; args: unknown }
export type WireResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
