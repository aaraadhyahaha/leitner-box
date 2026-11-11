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
export interface ImportResult {
  committed: boolean;
  batchId: number | null;            // null when nothing was added or commit=false
  added: number; duplicates: number;
  errorCount: number; errors: ImportError[]; // errors holds the first 100
  decks: { name: string; added: number }[];
}
export interface AnswerResult { reviewId: number; box: Box; dueDay: number }

export interface Api {
  'deck.list':    { req: null; res: DeckSummary[] };
  'import.run':   { req: { file: File; defaultDeck: string; commit: boolean }; res: ImportResult };
  'study.due':    { req: { deckId: number; after: DueCursor | null; limit: number }; res: Card[] };
  'study.answer': { req: { cardId: number; correct: boolean }; res: AnswerResult };
}
export type Op = keyof Api;
export interface WireRequest { id: number; op: Op; args: unknown }
export type WireResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
