import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';
import { dayNumber } from '../leitner';
import { readCards } from '../import-parse';
import { answerCard, dueCards, listDecks, migrate, runImport } from './ops';
import type { Api, Op, WireRequest, WireResponse } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function init(): Promise<Database> {
  const sqlite3 = await sqlite3InitModule();
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'leitner-pool' });
  const db = new pool.OpfsSAHPoolDb('/leitner.db');
  migrate(db);
  return db;
}

const today = () => dayNumber(Date.now(), new Date().getTimezoneOffset());

type Handlers = {
  [K in Op]: (db: Database, args: Api[K]['req']) => Api[K]['res'] | Promise<Api[K]['res']>;
};

const handlers: Handlers = {
  'deck.list': (db) => listDecks(db, today()),
  'import.run': (db, args) =>
    runImport(db, readCards(args.file), {
      defaultDeck: args.defaultDeck,
      source: args.file.name,
      commit: args.commit,
      now: Date.now(),
      today: today(),
    }),
  'study.due': (db, args) => dueCards(db, args.deckId, today(), args.after, args.limit),
  'study.answer': (db, args) => answerCard(db, args.cardId, args.correct, Date.now(), today()),
};

const dbReady = init();
// Swallow here so the chain itself never rejects; each request awaits dbReady and reports its error.
let chain: Promise<unknown> = dbReady.catch(() => undefined);

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function handle(req: WireRequest): Promise<WireResponse> {
  try {
    const db = await dbReady;
    const handler = handlers[req.op] as (db: Database, args: unknown) => unknown;
    if (!handler) throw new Error(`Unknown op: ${String(req.op)}`);
    const result = await handler(db, req.args);
    return { id: req.id, ok: true, result };
  } catch (e) {
    return { id: req.id, ok: false, error: message(e) };
  }
}

ctx.onmessage = (ev: MessageEvent<WireRequest>) => {
  const req = ev.data;
  chain = chain.then(() => handle(req)).then((res) => ctx.postMessage(res));
};
