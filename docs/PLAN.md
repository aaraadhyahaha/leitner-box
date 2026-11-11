# Leitner Box: Build Plan

Tier 1 is the MVP. Tier 2 follows in the listed order. Each card goes to one Opus executor together with §0 and the §1 parts it names. The orchestrator runs the check, commits, ticks `docs/STATUS.md`, and updates the file map in `CLAUDE.md`.

## 0. Executor rules (prepend to every card)

- Touch only the files the card lists. Don't explore. Never read `node_modules/`, `dist/` or lockfiles.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`). TypeScript strict. No UI or CSS framework.
- CSS uses only tokens from `src/styles/tokens.css`. No raw colours; no raw sizes except `0` and `1px`.
- Don't add dependencies. Don't change `src/lib/db/types.ts` unless the card says so.
- If something in the card is wrong (a library API differs, a signature can't work), stop and report. Don't improvise.
- Finish by running the card's check and reporting its output. Don't commit.

## 1. Contracts

### 1.1 Dependencies (installed by T1.1 at latest versions)

- Runtime: `@sqlite.org/sqlite-wasm`, `katex`, `smiles-drawer`, `@lucide/svelte`, `@fontsource-variable/inter`
- Dev: `vite`, `@sveltejs/vite-plugin-svelte`, `svelte`, `typescript`, `svelte-check`, `vitest`
- Tier 2 only: `vite-plugin-pwa` (T2.7)

### 1.2 File map (Tier 1)

```
index.html  package.json  vite.config.ts  svelte.config.js  tsconfig.json  .gitignore
fixtures/sample.jsonl
docs/PLAN.md STATUS.md UI.md IMPORT_FORMAT.md
src/main.ts  src/App.svelte  src/vite-env.d.ts  src/types/shims.d.ts
src/styles/tokens.css  base.css
src/lib/leitner.ts  session.ts  import-parse.ts  router.svelte.ts  decks.svelte.ts   (+ *.test.ts)
src/lib/db/types.ts  schema.ts  ops.ts  worker.ts  client.ts  ops.test.ts
src/lib/render/tokenize.ts  render.ts  smiles.ts  RichText.svelte  (+ *.test.ts)
src/components/Alert.svelte  Toolbar.svelte  Sidebar.svelte  ImportButton.svelte  DeckView.svelte  StudyView.svelte
```

### 1.3 `src/lib/db/types.ts` (verbatim; the only shared contract between UI and worker)

```ts
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
```

### 1.4 `src/lib/db/schema.ts` exports `SCHEMA_V1: string` (verbatim SQL)

```sql
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
```

`migrate(db)` runs `PRAGMA foreign_keys = ON` every time, and runs `SCHEMA_V1` in a transaction only when `user_version` is 0.

### 1.5 Semantics (fixed)

- **Day number**: `dayNumber(epochMs, tzOffsetMin) = floor((epochMs - tzOffsetMin*60000) / 86400000)` (local calendar day). The worker computes `today` itself with `new Date().getTimezoneOffset()`.
- **Leitner**: `INTERVALS = [1, 2, 4, 8, 16]` days for boxes 1..5. Correct: `box = min(box + 1, 5)`. Wrong: `box = 1`. Then `dueDay = today + INTERVALS[box - 1]`. A new card is box 1 with `due_day = today`. A card is due when `due_day <= today`.
- **Session**: a card's first answer in a session is persisted (`study.answer`). A wrong card is reinserted 4 places ahead (or at the end if the queue is shorter). Answering a reinserted card is not persisted: wrong reinserts it again, right drops it.
- **Dedupe**: `hash = cardHash(front, back)` over NFC-normalised, trimmed text. Duplicate means same deck and same hash, whether already in the DB or earlier in the same file.
- **Tags**: `string[]` in the API and in JSONL; stored space-separated. Inner whitespace in a tag becomes `-`.
- **Worker** handles requests strictly one at a time (a promise chain), so an import's transaction can await the file stream safely.
- **Keys in study**: Space reveals. After reveal: `ArrowRight` or `2` = Right, `ArrowLeft` or `1` = Wrong. `Escape` exits. Ignore keys with Ctrl/Meta/Alt held.

### 1.6 Import format (source for `docs/IMPORT_FORMAT.md` and the parser)

- JSONL, UTF-8, one JSON object per line; blank lines are skipped. A file whose first non-whitespace character is `[` is read as one JSON array of the same objects (element *i* is reported as line *i + 1*).
- Fields: `front` (string, required, non-empty after trim), `back` (same), `deck` (string, optional; falls back to the deck chosen at import), `tags` (optional; array of strings, or one string split on commas and whitespace). Unknown fields are ignored.
- Markup inside `front`/`back`: `$…$` inline math, `$$…$$` display math, `\ce{…}` and `\pu{…}` (inside math or bare), `{{smiles:CCO}}` or `{{smiles:CCO|ethanol}}`, `\$` for a literal dollar. Everything else is plain text; newlines are kept.
- Backslashes must be doubled in JSON: `"$\\frac{1}{2}$"`, `"\\ce{H2O}"`.
- Error messages, exactly: `Invalid JSON`, `Not an object`, `Missing front`, `Missing back`, `deck must be a string`, `tags must be an array of strings`, `Invalid JSON array`.

## 2. Tier 1 cards (MVP)

Order: **T1.1**, then **wave A in parallel (T1.2 to T1.6)**, then **T1.7**, then **wave C in parallel (T1.8, T1.9)**, then **T1.10** (orchestrator). The orchestrator runs `git init` before T1.1.

### T1.1 Scaffold and contracts · alone, first · needs §1.1, §1.3
Files: `package.json`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`, `.gitignore`, `index.html`, `src/main.ts`, `src/App.svelte`, `src/vite-env.d.ts`, `src/types/shims.d.ts`, `src/lib/db/types.ts`, `src/styles/tokens.css`, `src/styles/base.css`, `src/components/StudyView.svelte`.
- Write the files by hand (no interactive `npm create`), then `npm install` the §1.1 packages.
- Scripts: `dev: vite`, `build: vite build`, `preview: vite preview`, `check: svelte-check --tsconfig ./tsconfig.json`, `test: vitest run`.
- `vite.config.ts`: `plugins: [svelte()]`, `base: './'`, `worker: { format: 'es' }`, `optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] }`, `test: { environment: 'node', include: ['src/**/*.test.ts'] }`.
- `svelte.config.js`: `vitePreprocess()`. `tsconfig.json`: strict, `moduleResolution: "bundler"`, `target: "ES2022"`, `lib: ["ES2022","DOM","DOM.Iterable","WebWorker"]`, `types: ["svelte","vite/client"]`.
- `src/types/shims.d.ts`: `declare module 'smiles-drawer';` and `declare module 'katex/contrib/mhchem';`.
- `src/lib/db/types.ts`: §1.3 verbatim.
- `src/main.ts`: import `@fontsource-variable/inter`, `./styles/tokens.css`, `./styles/base.css`; `mount(App, { target: document.getElementById('app')! })`; then `navigator.storage?.persist?.()` (ignore the result).
- Stubs: `tokens.css` and `base.css` each hold one comment line. `App.svelte` renders `<main>Leitner Box</main>`. `StudyView.svelte` declares `let { deckId }: { deckId: number } = $props();` and renders nothing.
- `index.html`: `<title>Leitner Box</title>`, `<meta name="color-scheme" content="light dark">`, `<div id="app">`.
- Check: `npm run check && npx vitest run --passWithNoTests`

### T1.2 Leitner and session logic · wave A · needs §1.3, §1.5
Files: `src/lib/leitner.ts`, `src/lib/leitner.test.ts`, `src/lib/session.ts`, `src/lib/session.test.ts`.
```ts
// leitner.ts
export const BOX_COUNT = 5;
export const INTERVALS: readonly number[]; // [1, 2, 4, 8, 16]
export function dayNumber(epochMs: number, tzOffsetMin: number): number;
export function review(box: Box, correct: boolean, today: number): { box: Box; dueDay: number };

// session.ts
export class StudySession<T extends { id: number }> {
  constructor(gap?: number);                 // default 4
  push(cards: T[]): void;                    // append newly fetched due cards
  get current(): T | null;                   // head of the queue
  get pending(): number;                     // queue length
  get answered(): number;                    // cards answered for the first time
  peek(n: number): T[];                      // the n cards after current
  answer(correct: boolean): { card: T; persist: boolean }; // throws if empty
}
```
- `answer`: removes the head; `persist` is true only the first time that card id is answered; when wrong, reinsert the card at index `min(gap, queue.length)`.
- Tests: every box transition for right and wrong; box 5 stays 5; `dayNumber` across a timezone offset and midnight; a wrong card returns after 4 others; a wrong card in a short queue returns last; repeat answers give `persist: false`; a twice-wrong card returns twice.
- Check: `npx vitest run src/lib/leitner.test.ts src/lib/session.test.ts`

### T1.3 Import parser · wave A · needs §1.5, §1.6
Files: `src/lib/import-parse.ts`, `src/lib/import-parse.test.ts`.
```ts
export interface ParsedCard { deck: string | null; front: string; back: string; tags: string[] }
export type Parsed = { ok: true; card: ParsedCard } | { ok: false; message: string };
export type ParsedLine = Parsed & { line: number };
export function validateCard(value: unknown): Parsed;
export function parseLine(text: string): Parsed;              // JSON.parse + validateCard
export function cardHash(front: string, back: string): string;
export function readCards(file: Blob): AsyncGenerator<ParsedLine>;
```
- `validateCard`: rules and messages from §1.6. Trim `front`, `back`, `deck`; empty `deck` becomes `null`; tags trimmed, inner whitespace to `-`, empties dropped, de-duplicated.
- `cardHash`: NFC-normalise and trim both, join with `\u0000`, run the well-known `cyrb53(str, seed)` with seeds 0 and 1, return the two results as 14-digit zero-padded hex, concatenated (28 chars).
- `readCards`: read `file.slice(0, 64).text()`; if the first non-whitespace character (after an optional BOM) is `[`, parse `await file.text()` as an array (failure yields one `{ line: 1, ok: false, message: 'Invalid JSON array' }`). Otherwise stream `file.stream().pipeThrough(new TextDecoderStream())`, split on `\n`, strip a trailing `\r` and a leading BOM, skip blank lines, keep 1-based line numbers, and yield `parseLine` results. Never hold the whole JSONL file in memory.
- Tests: each error message; tags as array and as string; CRLF, BOM, blank lines, no final newline, a line split across chunks (build the Blob from several parts); array form; hash equal under trimming, different for different text.
- Check: `npx vitest run src/lib/import-parse.test.ts`

### T1.4 Rendering · wave A · needs §1.6 (markup bullet)
Files: `src/lib/render/tokenize.ts`, `tokenize.test.ts`, `render.ts`, `render.test.ts`, `smiles.ts`, `RichText.svelte`.
```ts
// tokenize.ts
export type Token =
  | { type: 'text'; value: string }
  | { type: 'math'; tex: string; display: boolean; raw: string }
  | { type: 'smiles'; smiles: string; caption: string | null; raw: string };
export function tokenize(src: string): Token[];
// render.ts
export function escapeHtml(s: string): string;
export function renderToHtml(src: string): string;
// smiles.ts
export function hydrateSmiles(root: HTMLElement): Promise<void>;
```
- `tokenize`, one left-to-right scan: `\$` is a literal `$`; `$$…$$` is display math (may span lines); `$…$` is inline math (non-empty, same paragraph); `{{smiles:S}}` and `{{smiles:S|caption}}` (trim both); bare `\ce{…}` or `\pu{…}` outside math with balanced braces is inline math whose `tex` is the whole command. Anything unmatched stays text. Merge adjacent text tokens. `raw` is the exact source slice.
- `renderToHtml`: text is `escapeHtml` then `\n` to `<br>`. Math is `katex.renderToString(tex, { displayMode, throwOnError: true, strict: 'ignore', trust: false })` with `import 'katex/contrib/mhchem'`; on throw emit `<span class="render-warn" title="{escaped message}">{escaped raw}</span>`. SMILES emits `<span class="smiles" data-smiles="{escaped}"><svg class="smiles-svg" role="img" aria-label="{escaped caption or smiles}"></svg>{caption ? <span class="smiles-caption">…</span> : ''}</span>`. Cache results in a `Map` used as an LRU of 500 entries.
- `hydrateSmiles`: for each `.smiles:not([data-done])` under `root`, load the library with `const SD = (await import('smiles-drawer')).default` (the only import of it anywhere), then `SD.parse(smiles, tree => new SD.SvgDrawer({ width: 240, height: 180 }).draw(tree, svgEl, theme), onError)` where `theme` is `'dark'` or `'light'` from `matchMedia('(prefers-color-scheme: dark)')`. On error replace the span's content with a `.render-warn` showing the raw SMILES. Set `data-done`. Never throw.
- `RichText.svelte`: `let { source }: { source: string } = $props();` imports `katex/dist/katex.min.css`, renders `<div class="rich-text" bind:this={el}>{@html renderToHtml(source)}</div>`, and calls `hydrateSmiles(el)` in an `$effect` that tracks `source`. Styles for `.render-warn` (orange text, dotted underline), `.smiles`, `.smiles-caption` use tokens from `docs/UI.md`.
- Tests: tokenizer cases for every rule plus unmatched `$`, `\$`, nested braces in `\ce`; `renderToHtml` escapes `<script>`; bad LaTeX gives `.render-warn` and does not throw; `\ce{H2O}` renders; the second call returns the cached string.
- Check: `npx vitest run src/lib/render`

### T1.5 Tokens, base styles, Alert, Toolbar · wave A · needs all of `docs/UI.md`
Files: `src/styles/tokens.css`, `src/styles/base.css`, `src/components/Alert.svelte`, `src/components/Toolbar.svelte`.
- `tokens.css`: every token in UI.md §1 to §4 with the exact names and values, on `:root`, with dark values under `@media (prefers-color-scheme: dark)`, plus the `prefers-contrast: more` and `prefers-reduced-motion: reduce` overrides.
- `base.css`: UI.md §5 (reset, body, focus ring, `.btn` variants, `.empty-state`, scrollbars).
- `Alert.svelte` (a native `<dialog>` opened with `showModal()`):
  ```ts
  let { open = $bindable(false), title, message = '', confirmLabel = 'OK', cancelLabel = null,
        destructive = false, onconfirm, oncancel }: {
    open?: boolean; title: string; message?: string; confirmLabel?: string;
    cancelLabel?: string | null; destructive?: boolean;
    onconfirm?: () => void; oncancel?: () => void } = $props();
  ```
  When `cancelLabel` is set, Cancel is the default button: it gets focus and Enter triggers it. A destructive confirm button is never focused on open. Esc cancels. With no `cancelLabel`, the confirm button is the default.
- `Toolbar.svelte`: `let { title, subtitle = '', children }: { title: string; subtitle?: string; children?: Snippet } = $props();` Title and subtitle on the left, `{@render children?.()}` on the right. Layout per UI.md §6.
- Check: `npm run check`

### T1.6 Import format doc and sample file · wave A · needs §1.6
Files: `docs/IMPORT_FORMAT.md`, `fixtures/sample.jsonl`.
- `IMPORT_FORMAT.md`, in this order: a one-paragraph summary; the field table; the markup table with one example each; a "Backslashes must be doubled" section showing wrong and right lines for `\frac`, `\ce` and `\text`; how duplicates and errors are treated on import; a copy-paste prompt in one fenced block.
- The prompt takes `<DECK NAME>`, `<TOPIC OR SOURCE MATERIAL>` and `<NUMBER>` placeholders and tells the agent to: output only JSONL with no code fence or commentary; put one fact on each card; set `"deck"` to the deck name on every line; double every backslash; use `$…$`, `\\ce{…}` and `{{smiles:…}}` where they fit; keep fronts unique; use lowercase hyphenated tags; re-read each line as JSON before finishing. It includes three example lines (LaTeX, mhchem, SMILES).
- `fixtures/sample.jsonl`: exactly 12 lines. 10 valid cards in deck `Sample` covering plain text, inline and display math, `\\ce`, both SMILES forms, tags as array and as string, and one card with no `deck`. Line 11 repeats line 1 exactly. Line 12 is `{"front": "broken"` (invalid JSON). Expected import: 10 added, 1 duplicate, 1 error.
- Check: `node -e "const l=require('fs').readFileSync('fixtures/sample.jsonl','utf8').trim().split('\n');let ok=0,bad=0;for(const x of l){try{JSON.parse(x);ok++}catch{bad++}}process.exit(ok===11&&bad===1?0:1)"`

### T1.7 Database worker, operations and client · after T1.2 and T1.3 · needs §1.3, §1.4, §1.5 and the signatures in T1.2 and T1.3
Files: `src/lib/db/schema.ts`, `ops.ts`, `ops.test.ts`, `worker.ts`, `client.ts`.
```ts
// ops.ts (pure functions over an oo1 database handle; no worker or OPFS code here)
import type { Database } from '@sqlite.org/sqlite-wasm';
export function migrate(db: Database): void;
export function listDecks(db: Database, today: number): DeckSummary[];
export function runImport(db: Database, cards: AsyncIterable<ParsedLine>, opts: {
  defaultDeck: string; source: string; commit: boolean; now: number; today: number }): Promise<ImportResult>;
export function dueCards(db: Database, deckId: number, today: number, after: DueCursor | null, limit: number): Card[];
export function answerCard(db: Database, cardId: number, correct: boolean, now: number, today: number): AnswerResult;
// client.ts
export function call<K extends Op>(op: K, args: Api[K]['req']): Promise<Api[K]['res']>;
```
- `listDecks`: one query, `decks LEFT JOIN cards GROUP BY d.id, c.box`, with `COUNT(c.id)` and `SUM(c.due_day <= ?)`, ordered by name; fold the rows into `DeckSummary`.
- `runImport`: `BEGIN`; insert the batch row; prepare the statements once. For each item: an error increments `errorCount` (keep the first 100 in `errors`); otherwise resolve the deck through a `Map` of lower-cased names (`INSERT … ON CONFLICT DO NOTHING`, then select the id), insert the card with `box 1, due_day today` using `ON CONFLICT(deck_id, hash) DO NOTHING`, and use `db.changes()` to count it as added or duplicate. At the end set `batches.card_count`; delete the batch row if nothing was added. `COMMIT` when `opts.commit`, otherwise `ROLLBACK`. Any exception rolls back and is rethrown. `batchId` is null unless committed with `added > 0`.
- `dueCards`: `WHERE deck_id = ? AND due_day <= ? AND (due_day, id) > (?, ?) ORDER BY due_day, id LIMIT ?` (drop the cursor clause when `after` is null).
- `answerCard`: in one transaction, read the card, compute `review()` from `leitner.ts`, update `box`, `due_day`, `updated_at`, insert the `reviews` row with the previous and new values, and return `reviewId`.
- `worker.ts`: `const sqlite3 = await sqlite3InitModule()`; `const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'leitner-pool' })`; `const db = new pool.OpfsSAHPoolDb('/leitner.db')`; `migrate(db)`. A `handlers` object typed `{ [K in Op]: (args: Api[K]['req']) => Api[K]['res'] | Promise<Api[K]['res']> }`. `import.run` passes `readCards(args.file)` and `source: args.file.name`. Requests run one at a time on a promise chain that starts with init; every request gets a `WireResponse` (errors as `{ ok: false, error: message }`, including an init failure).
- `client.ts`: create the worker lazily with `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`; match responses to pending promises by `id`; reject with `new Error(error)`.
- `ops.test.ts` (in-memory `new sqlite3.oo1.DB(':memory:')` under Node; feed `runImport` with `readCards(new Blob([...]))`): migrate twice is safe; import counts added, duplicates and errors; importing the same text twice adds 0 and leaves no second batch; `commit: false` leaves the tables empty but returns the same counts; `listDecks` box and due counts; `dueCards` paging with the cursor; `answerCard` right and wrong, with the review row; an FTS `MATCH` finds an imported card.
- If SQLite WASM cannot initialise under Node, don't work around it: skip `ops.test.ts`, say so in the report, and use `npm run check` as the check.
- Check: `npx vitest run src/lib/db/ops.test.ts && npm run check`

### T1.8 App shell, sidebar, import, deck view · wave C · needs §1.3, UI.md §6, the `Alert` and `Toolbar` props from T1.5, `call` from T1.7
Files: `src/lib/router.svelte.ts`, `src/lib/router.test.ts`, `src/lib/decks.svelte.ts`, `src/App.svelte`, `src/components/Sidebar.svelte`, `ImportButton.svelte`, `DeckView.svelte`.
```ts
// router.svelte.ts
export type Route = { name: 'home' } | { name: 'deck'; deckId: number } | { name: 'study'; deckId: number };
export function parseHash(hash: string): Route;   // '#/', '#/deck/12', '#/study/12'; anything else is home
export function toHash(route: Route): string;
export const router: { route: Route };            // $state, kept in sync with 'hashchange'
export function go(route: Route): void;
// decks.svelte.ts
export const deckStore: { decks: DeckSummary[]; loaded: boolean; error: string | null }; // $state
export function refreshDecks(): Promise<void>;    // call('deck.list', null); sets error on failure
```
- `App.svelte`: split view per UI.md §6. Calls `refreshDecks()` on mount. Main pane by route: `home` shows an empty state ("No Deck Selected", or "No Decks" with an Import button when there are none); `deck` shows `<DeckView deckId>`; `study` shows `<StudyView deckId>`. If `deckStore.error` is set, the main pane shows an error empty state with the message.
- `Sidebar.svelte`: a "Decks" section header and one 28 px row per deck: name, and a due-count badge when `due > 0`. The row for the current route is selected. Click or Enter goes to the deck; Up/Down move the selection. Empty state "No Decks".
- `ImportButton.svelte`: a toolbar button (Lucide `FileDown`, label "Import…") with a hidden `<input type="file" accept=".jsonl,.json,.txt">`. `defaultDeck` is the current deck's name on a deck route, otherwise the file name without its extension. Calls `call('import.run', { file, defaultDeck, commit: true })`, disables itself while running, then shows an `Alert`: title "Imported N Cards" and message "D duplicates skipped. E lines had errors." (drop a sentence whose count is 0; on a rejected call, title "Import Failed" with the error). Then `refreshDecks()`. Reset the input so the same file can be picked again.
- `DeckView.svelte`: `let { deckId }: { deckId: number } = $props();` reads the deck from `deckStore`. Toolbar: deck name, subtitle "N cards", `ImportButton`. Content per UI.md §6: due count, five box cells, a primary "Study" button (disabled when `due` is 0; Enter starts it) that calls `go({ name: 'study', deckId })`. Empty state "Deck Not Found" for an unknown id.
- Tests: `parseHash` and `toHash` round-trip and bad input.
- Check: `npx vitest run src/lib/router.test.ts && npm run check`

### T1.9 Study view · wave C · needs §1.3, §1.5, UI.md §6, `StudySession` from T1.2, `RichText` and `renderToHtml` from T1.4, `call` from T1.7, `go` and `refreshDecks` signatures from T1.8
Files: `src/components/StudyView.svelte` (replaces the stub).
- Props `{ deckId: number }`. On mount: `call('study.due', { deckId, after: null, limit: 20 })`, then `session.push`. When `session.pending < 5` and the last page was full, fetch the next page with `after` set to the last fetched card's `{ dueDay, id }`.
- States: loading; question (front only); answer (front, separator, back, and the Wrong and Right buttons at 44 px); done ("Session Complete", the count from `session.answered`, a "Back to Deck" button); empty ("Nothing Due").
- Answering: `const { card, persist } = session.answer(correct)`; when `persist`, `call('study.answer', { cardId: card.id, correct })` without blocking the next card; show a failure in an inline warning line. `StudySession` is a plain class, so keep `current`, `pending` and `revealed` in `$state` and refresh them after each call.
- After each card change, call `renderToHtml` on the front and back of `session.peek(3)` inside `requestIdleCallback` (fall back to `setTimeout`) so the next card is already cached.
- Keys on `window` per §1.5, with `preventDefault` on Space. Esc, the toolbar "Done" button and "Back to Deck" all call `refreshDecks()` then `go({ name: 'deck', deckId })`.
- The toolbar shows the deck name and "N remaining" (`session.pending`).
- Check: `npm run check`

### T1.10 MVP smoke test · orchestrator, no executor
`npm run build`, then `npm run preview` and in Chromium: import `fixtures/sample.jsonl` (expect 10 added, 1 duplicate, 1 error); import it again (0 added); study the deck with the keyboard only, answer one card wrong and see it return; check math, mhchem and SMILES render; reload and confirm the data persisted; toggle dark mode. Repeat the import and one study pass in Firefox. Fix through small follow-up cards.

## 3. Tier 2 cards (in this order; one at a time unless marked)

Each card is expanded to T1 detail (props, SQL, tests) by the orchestrator just before dispatch; the API additions below are already fixed. Every card that adds an op edits `types.ts`, `ops.ts`, `ops.test.ts` and `worker.ts`.

- **T2.0 Extend `docs/UI.md`** (orchestrator): card list, selection, sheets, editor, batches. No code.
- **T2.1 Card list, search, box filter.** Files: `src/components/VirtualList.svelte`, `CardList.svelte`, `SearchField.svelte`, `DeckView.svelte`. API:
  ```ts
  export interface CardQuery { deckId: number; search: string; box: Box | null; batchId: number | null }
  'card.list':  { req: { query: CardQuery; after: DueCursor | null; limit: number }; res: { cards: Card[]; next: DueCursor | null } };
  'card.count': { req: CardQuery; res: number };
  ```
  Order is `(due_day, id)` through `cards_deck_due` or `cards_deck_box`; with a search it is by `id` through `cards_fts MATCH` (the cursor's `dueDay` is ignored). The user's text is turned into quoted prefix terms. Fixed-height rows showing plain source text, pages of 200, only visible rows in the DOM. `/` focuses search. Check: `npx vitest run src/lib/db/ops.test.ts && npm run check`.
- **T2.2 Bulk delete.** Files: `src/lib/selection.svelte.ts` (+ test), `CardList.svelte`, `BatchesSheet.svelte`, `Sidebar.svelte`. Selection is `{ mode: 'ids'; ids: Set<number> } | { mode: 'all'; except: Set<number> }` with click, Ctrl/⌘-click, Shift-click range and "Select All Matching". API:
  ```ts
  'card.delete':  { req: { ids: number[] } | { query: CardQuery; exceptIds: number[] }; res: { deleted: number } };
  'batch.list':   { req: null; res: { id: number; source: string; createdAt: number; cardCount: number }[] }; // live count
  'batch.delete': { req: { id: number }; res: { deleted: number } };
  'deck.delete':  { req: { id: number }; res: { deleted: number } };
  ```
  Each runs in one transaction and each is confirmed with `Alert` (Cancel default). Check: `npx vitest run src/lib/selection.test.ts src/lib/db/ops.test.ts && npm run check`.
- **T2.3 Import preview sheet.** Files: `src/components/Sheet.svelte`, `ImportSheet.svelte`, `ImportButton.svelte`. No new op: run `import.run` with `commit: false`, show valid, duplicate and error counts with line numbers and the per-deck breakdown, then run it again with `commit: true`. Pasted text is wrapped as `new File([text], 'pasted.jsonl')` on the main thread. Check: `npm run check`.
- **T2.4 Deck and card editor.** Files: `CardEditorSheet.svelte`, `DeckNameSheet.svelte`, `Sidebar.svelte`, `CardList.svelte`. API: `'deck.create': { req: { name: string }; res: { id: number } }`, `'deck.rename': { req: { id: number; name: string }; res: null }`, `'card.create': { req: { deckId: number; front: string; back: string; tags: string[] }; res: { id: number } }`, `'card.update': { req: { id: number; front: string; back: string; tags: string[] }; res: null }`. A duplicate rejects with `Duplicate card`. Live `RichText` preview; Ctrl/⌘+Enter saves; `N` opens a new card when no field has focus. Check: `npx vitest run src/lib/db/ops.test.ts && npm run check`.
- **T2.5 Undo review.** Files: `session.ts` (+ test), `StudyView.svelte`. API: `'study.undo': { req: { reviewId: number }; res: Card }` restores `prev_box` and `prev_due_day` and deletes the review row. `StudySession.undo(): { card: T; persisted: boolean } | null` restores the queue from a one-step snapshot. Key `U`. Check: `npx vitest run src/lib/session.test.ts src/lib/db/ops.test.ts && npm run check`.
- **T2.6 Export.** Files: `ExportButton.svelte`. API: `'export.jsonl': { req: { deckId: number | null }; res: Blob }`, built in the worker in chunks, one §1.6 object per line with `deck` always set and `tags` as an array; the main thread saves it with an `<a download>`. Test: export then import into an empty DB gives the same cards; importing into the same DB adds 0. Check: `npx vitest run src/lib/db/ops.test.ts && npm run check`.
- **T2.7 PWA and offline.** Files: `vite.config.ts`, `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png`, `index.html`, `src/main.ts`. `vite-plugin-pwa` with `generateSW`, precaching JS, CSS, WASM and fonts. Check: `npm run build`, then the orchestrator loads the preview offline.
- **T2.8 100k performance check.** Files: `scripts/gen-cards.mjs` (`node scripts/gen-cards.mjs 100000 > /tmp/cards.jsonl`, with math and SMILES mixed in), `src/lib/bench.ts` (dev-only `window.__bench(file)` that times import, `deck.list`, paged `card.list` with and without search, and `study.due`). The orchestrator runs it in Chromium against the CLAUDE.md targets and issues fix cards for any miss (first candidates: drop the FTS triggers during import and rebuild the index once; a per-deck counts table).
- **T2.9 HIG audit.** The orchestrator audits every screen against `docs/UI.md` and the CLAUDE.md UI section (light, dark, increased contrast, reduced motion, keyboard-only, empty states, alert defaults), lists the findings in `STATUS.md`, and issues fix cards. Ends with `npm run test && npm run check && npm run build`.
