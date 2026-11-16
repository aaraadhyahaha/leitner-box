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
- Tier 2 adds no dependencies (T2.7 hand-writes the service worker).

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

Tier 2 adds:

```
src/lib/db/fts.ts  card-ops.ts  (+ *.test.ts)                                   T2.B
src/components/Sheet.svelte  Segmented.svelte  SearchField.svelte               T2.C
src/components/VirtualList.svelte  CardList.svelte                              T2.1
src/lib/selection.svelte.ts (+ test)  src/components/ImportsView.svelte         T2.2
src/components/ImportSheet.svelte  src/lib/render/warnings.ts (+ test)          T2.3
src/components/CardEditorSheet.svelte  DeckNameSheet.svelte                     T2.4
src/components/ExportButton.svelte                                              T2.6
public/manifest.webmanifest  icon.svg  sw-template.js                           T2.7
scripts/gen-cards.mjs  src/lib/bench.ts                                         T2.8
```

### 1.3 `src/lib/db/types.ts` (verbatim as of Tier 1; T2.B extends it; the only shared contract between UI and worker)

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

## 3. Tier 2 cards

Feature cards T2.1 to T2.9 follow the Tier 2 feature order. T2.B holds every worker API change and T2.C the shared UI primitives, so the feature cards never edit `types.ts`, `worker.ts`, `tokens.css` or `base.css`. No schema change.

### Order and parallelism

```
T2.A (done, orchestrator)
wave D  parallel:  T2.B  T2.C
wave E  parallel:  T2.1  T2.3  T2.5  T2.6  T2.7
wave F  alone:     T2.2            (after T2.1 and T2.6)
wave G  alone:     T2.4            (after T2.2)
then    alone:     T2.8, then T2.9 (orchestrator)
```
Cards in one wave touch disjoint files. After each wave the orchestrator runs `npm run test && npm run check`, commits per card, ticks STATUS and updates the CLAUDE.md file map.

### T2.A Extend `docs/UI.md` · orchestrator · done
UI.md §7 (Tier 2 screens) and §8 (audit checklist).

### T2.B API contract and DB ops · wave D · needs §0, §1.3 to §1.6
Files: `src/lib/db/types.ts`, `ops.ts`, `ops.test.ts`, `worker.ts`, new `src/lib/db/fts.ts`, `fts.test.ts`, `card-ops.ts`, `card-ops.test.ts`.

`types.ts`: change `ImportResult.decks` and add `sample`; add the rest verbatim.
```ts
export interface ImportSample { line: number; front: string; back: string }
// in ImportResult:
//   decks: { name: string; added: number; isNew: boolean }[];
//   sample: ImportSample[];            // the first 20 added cards
export interface CardQuery { deckId: number; search: string; box: Box | null }
export interface CardPage { cards: Card[]; next: DueCursor | null }  // next is null on the last page
export type CardSelection = { ids: number[] } | { query: CardQuery; exceptIds: number[] };
export interface CardInput { deckId: number; front: string; back: string; tags: string[] }
export interface BatchSummary {
  id: number; source: string; createdAt: number;
  cardCount: number;                   // cards still alive
  deckCount: number; deckName: string; // deckName is the alphabetically first deck
}
// added to Api:
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
```

`ops.ts` (small edits only):
- Export `num` and `splitTags`. Add and export `CARD_COLS = 'id, deck_id, batch_id, front, back, tags, box, due_day'` and `toCard(row: SqlValue[]): Card`; `dueCards` uses them.
- `runImport`: in `resolveDeck`, read `db.changes() > 0` right after `insDeck.step()` and keep it as `isNew` on the map entry; return it in `decks`. Push `{ line: item.line, front, back }` to `sample` for the first 20 added cards; return `sample`.

`fts.ts`: `export function ftsQuery(text: string): string | null`. NFC-normalise, split on whitespace, remove every `"`, drop terms without a letter or digit (`/[\p{L}\p{N}]/u`), keep the first 8, map each to `"term"*`, join with a space. No terms gives `null`.

`card-ops.ts` (`db: Database` first, like `ops.ts`):
```ts
export function listCards(db, q: CardQuery, after: DueCursor | null, limit: number): CardPage;
export function countCards(db, q: CardQuery): number;
export function deleteCards(db, sel: CardSelection): number;
export function createCard(db, input: CardInput, now: number, today: number): Card;
export function updateCard(db, input: CardInput & { id: number }, now: number): Card;
export function createDeck(db, name: string, now: number): number;
export function renameDeck(db, id: number, name: string): void;
export function deleteDeck(db, id: number): number;          // returns cards deleted
export function listBatches(db): BatchSummary[];
export function deleteBatch(db, id: number): number;
export function undoReview(db, reviewId: number): Card;
export function exportJsonl(db, deckId: number | null): Blob;
```
- A private `where(q)` builds the clause and binds once for list, count and delete. `fts = ftsQuery(q.search)`.
  - No `fts`: `FROM cards c WHERE c.deck_id = ? [AND c.box = ?]`; list adds `[AND (c.due_day, c.id) > (?, ?)] ORDER BY c.due_day, c.id LIMIT ?`.
  - With `fts`: `FROM cards_fts JOIN cards c ON c.id = cards_fts.rowid WHERE cards_fts MATCH ? AND c.deck_id = ? [AND c.box = ?]`; list adds `[AND c.id > ?] ORDER BY c.id LIMIT ?` (the cursor's `dueDay` is ignored).
  - `next` is the last card's `{ dueDay, id }` when `cards.length === limit`, else `null`.
- `deleteCards`, in `db.transaction`: ids form is `DELETE FROM cards WHERE id IN (SELECT value FROM json_each(?))` bound to `JSON.stringify(ids)`; query form is `DELETE FROM cards WHERE id IN (SELECT c.id <where>) AND id NOT IN (SELECT value FROM json_each(?))`. Read `db.changes()` straight after, then run `DELETE FROM batches WHERE NOT EXISTS (SELECT 1 FROM cards WHERE batch_id = batches.id)`.
- `createCard` / `updateCard`: run `validateCard({ front, back, tags })` from `import-parse.ts` and throw `new Error(message)` on failure; unknown deck throws `Deck not found`; unknown card throws `Card not found`; if `SELECT 1 FROM cards WHERE deck_id = ? AND hash = ? AND id <> ?` finds a row throw `Duplicate card`. Create inserts box 1, `due_day = today`, `batch_id NULL`. Update sets `deck_id, front, back, tags, hash, updated_at` and leaves box and due day alone. Both return the row through `toCard`.
- `createDeck` / `renameDeck`: trim; empty throws `Deck name is empty`; another deck with that name (NOCASE) throws `Deck already exists`; a case-only rename of the same deck is allowed.
- `deleteDeck`, in a transaction: `DELETE FROM cards WHERE deck_id = ?` (take `changes()`), delete the deck, run the empty-batch cleanup.
- `listBatches`: `SELECT b.id, b.source, b.created_at, COUNT(c.id), COUNT(DISTINCT c.deck_id), MIN(d.name) FROM batches b JOIN cards c ON c.batch_id = b.id JOIN decks d ON d.id = c.deck_id GROUP BY b.id ORDER BY b.id DESC`.
- `deleteBatch`, in a transaction: `DELETE FROM cards WHERE batch_id = ?`, then the batch row.
- `undoReview`, in a transaction: read the review (`Review not found`); if a review with a larger id exists for that card throw `Cannot undo`; set the card's `box = prev_box, due_day = prev_due_day`; delete the review; return the card.
- `exportJsonl`: page by `c.id > ? ORDER BY c.id LIMIT 5000` joined to `decks` (optionally `c.deck_id = ?`); each row is `JSON.stringify({ deck, front, back, tags }) + '\n'` with `tags` an array; return `new Blob(parts, { type: 'application/x-ndjson' })`.

`worker.ts`: one handler per new op, same style as the existing four; `now` is `Date.now()`, `today` is `today()`. Handlers that return a count wrap it as `{ deleted }`; `deck.create` returns `{ id }`; `deck.rename` returns `null`.

Tests. `fts.test.ts`: quoting, prefix star, punctuation-only gives null, 8-term cap. `ops.test.ts`: `isNew` true on first import and false on the second; `sample` has at most 20 entries with line numbers. `card-ops.test.ts` (same in-memory setup as `ops.test.ts`): list pages through 450 cards in pages of 200 with no repeats and `next` null at the end; box filter; search by prefix and by two terms; count equals listed total for each query shape; delete by ids and by query with `exceptIds`, and an emptied batch disappears from `listBatches`; create/update happy path, `Duplicate card`, `Missing front`, moving a card to another deck; deck create/rename errors; `deleteDeck` removes its cards and FTS rows (`MATCH` finds nothing); `deleteBatch`; `undoReview` restores box and due day and removes the review, and `Cannot undo` for an older review; export of 3 decks re-imported into a fresh DB gives the same `(deck, front, back, tags)` set, and re-imported into the same DB adds 0.
- Check: `npx vitest run src/lib/db && npm run check`

### T2.C UI primitives · wave D · needs §0, all of `docs/UI.md`
Files: `src/styles/tokens.css`, `src/styles/base.css`, new `src/components/Sheet.svelte`, `Segmented.svelte`, `SearchField.svelte`.
- `tokens.css`: the UI.md §7.1 tokens. `base.css`: the UI.md §7.2 classes (`.btn-icon`, `.field`, `.field-label`, `.field-error`, `.list-row`, `.badge`).
- `Sheet.svelte`, a native `<dialog>` with `showModal()`, modelled on `Alert.svelte` (`margin: auto`, sync `open` on `cancel` and `close`):
  ```ts
  let { open = $bindable(false), title, wide = false, onclose, children, footer }: {
    open?: boolean; title: string; wide?: boolean; onclose?: () => void;
    children: Snippet; footer?: Snippet } = $props();
  ```
  Title row, scrolling body, footer row with buttons right-aligned. Esc closes and calls `onclose`. On open, focus the first element with `[data-autofocus]`, else the dialog.
- `Segmented.svelte`:
  ```ts
  let { value = $bindable(), options, label }: {
    value: string; options: { value: string; label: string; count?: number }[]; label: string } = $props();
  ```
  `role="radiogroup"` with `aria-label={label}`, one tab stop, Left/Right move and select, `count` shown after the label in `--label-secondary`.
- `SearchField.svelte`:
  ```ts
  let { value = $bindable(''), placeholder = 'Search', delay = 150 }: {
    value?: string; placeholder?: string; delay?: number } = $props();
  export function focus(): void;
  ```
  `<input type="search">` with a Lucide `Search` icon and a clear button (Lucide `X`, shown when non-empty). `value` updates `delay` ms after typing stops, at once on clear. Esc clears when non-empty, otherwise blurs.
- Check: `npm run check`

### T2.1 Card list, search, box filter · wave E · needs §0, T2.B types, T2.C props, UI.md §7.3
Files: new `src/components/VirtualList.svelte`, `CardList.svelte`; rewrite `DeckView.svelte`.
- `VirtualList.svelte` (`<script lang="ts" generics="T">`):
  ```ts
  let { items, rowHeight = 28, overscan = 10, row, onnearend, ...rest }: {
    items: T[]; rowHeight?: number; overscan?: number;
    row: Snippet<[T, number]>; onnearend?: () => void } & HTMLAttributes<HTMLDivElement> = $props();
  export function scrollToIndex(i: number): void;
  ```
  A scroll container (`...rest` spread on it) holding a spacer of `items.length * rowHeight` px and one absolutely positioned block translated to the first visible row. Visible range from `scrollTop` and a `ResizeObserver` height, updated in a passive scroll handler through `requestAnimationFrame`. Calls `onnearend` when the range end is within 50 rows of `items.length`.
- `CardList.svelte`:
  ```ts
  let { query, refreshKey = '', onopen }: {
    query: CardQuery; refreshKey?: string | number; onopen?: (card: Card) => void } = $props();
  ```
  Pages of 200 through `call('card.list', { query, after, limit: 200 })`. An `$effect` on `query` fields and `refreshKey` resets `cards`, `next` and bumps a generation counter; responses from an older generation are dropped. `onnearend` loads the next page when `next` is not null and no load is running. Row (`.list-row`, 28 px): front and back as single-line plain text (newlines to spaces, ellipsis), back in `--label-secondary`, then `Box n` in `--text-footnote`. Container `role="listbox"`, `tabindex="0"`, `aria-label="Cards"`. Double-click calls `onopen`. Empty states: "No Cards" / "Import a file or add a card." when the query has no search and no box; otherwise "No Results". A failed load shows an inline `.field-error` line with a Retry button.
- `DeckView.svelte`: toolbar title is the deck name, subtitle "N cards · D due". Toolbar children in order: `SearchField` (bound to `search`), `ImportButton`, `.btn.btn-primary` "Study" (disabled when `due` is 0). Under the toolbar, a filter bar (UI.md §7.3): `Segmented` with options `all` and `1` to `5`, counts from `deck.total` and `deck.boxes`, bound to a string that maps to `box: Box | null`; on the right "N matching" from `call('card.count', query)` when search or box is set. Then `<CardList {query} refreshKey={`${deck.total}:${deck.boxes.join()}`} />` filling the rest. `query` is `$derived` `{ deckId, search, box }`. Keys on `window`: `/` focuses search (not while typing in a field); Enter starts study as today (keep the existing target exclusions). Keep "Deck Not Found".
- Check: `npm run check`

### T2.2 Bulk delete and Imports · wave F · needs §0, T2.B types, UI.md §7.3 to §7.5, `Alert` props
Files: new `src/lib/selection.svelte.ts`, `selection.test.ts`, `src/components/ImportsView.svelte`; edit `CardList.svelte`, `DeckView.svelte`, `Sidebar.svelte`, `src/lib/router.svelte.ts`, `router.test.ts`, `src/App.svelte`.
```ts
// selection.svelte.ts
export type SelectionState = { mode: 'ids'; ids: Set<number> } | { mode: 'all'; except: Set<number> };
export class Selection {
  state: SelectionState;                    // $state; replace, never mutate in place
  anchor: number | null;                    // row index of the last plain or toggle click
  has(id: number): boolean;
  count(total: number): number;             // ids.size, or total - except.size
  click(index: number, idAt: (i: number) => number, mods: { toggle: boolean; range: boolean }): void;
  selectAll(): void;                        // { mode: 'all', except: empty }
  clear(): void;
  toRequest(query: CardQuery): CardSelection | null; // null when empty
}
```
- `click`: plain selects only that row and sets the anchor. `toggle` (Ctrl or ⌘) flips that row and sets the anchor. `range` (Shift) selects every row between the anchor and `index` inclusive, keeping the anchor; with no anchor it acts as plain. In `all` mode, toggle adds or removes the id in `except`, range removes the range from `except`, plain goes back to `ids` mode with that one row.
- `CardList.svelte`: new props `selection: Selection` and `ondelete?: () => void`. Click handling on the listbox (`data-index`, as in `Sidebar.svelte`). Rows get `aria-selected` and `.selected`; the container gets `aria-multiselectable="true"`. Keys: Up/Down move a cursor row and select it, Shift+Up/Down extend, Ctrl/⌘+A calls `selectAll()` (`preventDefault`), Delete or Backspace calls `ondelete`, Esc clears. A query change clears the selection.
- `DeckView.svelte`: owns `const selection = new Selection()`. When the selection is not empty the right side of the filter bar shows "K selected", a `.btn` "Select All N Matching" (only in `ids` mode with K < N; N from `card.count`), and a `.btn.btn-destructive` "Delete…". Delete opens `Alert` (title `Delete K Cards?` or `Delete 1 Card?`, message "This can't be undone.", `confirmLabel="Delete"`, `cancelLabel="Cancel"`, `destructive`), then `call('card.delete', selection.toRequest(query))`, `selection.clear()`, `refreshDecks()`. Add a `.btn-icon` toolbar button (Lucide `Trash2`, `aria-label` and `title` "Delete Deck…") with `Alert` title `Delete “{name}”?`, message "Its N cards will be deleted. This can't be undone.", then `call('deck.delete', { id })`, `refreshDecks()`, `go({ name: 'home' })`.
- Router: add `{ name: 'imports' }` as `#/imports`.
- `ImportsView.svelte`: toolbar "Imports" with subtitle "N imports". Loads `call('batch.list', null)` on mount and after each delete. Rows per UI.md §7.5 with a `.btn-icon` `Trash2` per row (`aria-label="Delete import {source}"`). `Alert`: title `Delete Import?`, message "“{source}” added N cards that are still in your library. They will be deleted. This can't be undone." Then `call('batch.delete', { id })` and `refreshDecks()`. Empty state "No Imports" / "Files you import are listed here so you can remove them in one step."
- `Sidebar.svelte`: under the deck list, a "Library" section header and one button styled as a sidebar row (Lucide `History`, "Imports"), selected on the imports route, `go({ name: 'imports' })`. It is its own tab stop.
- `App.svelte`: render `<ImportsView />` for the imports route.
- Tests: `selection.test.ts` covers plain, toggle, range up and down, range with no anchor, each action in `all` mode, `count`, `toRequest` in both modes and empty. `router.test.ts` gains `#/imports`.
- Check: `npx vitest run src/lib/selection.test.ts src/lib/router.test.ts && npm run check`

### T2.3 Import preview sheet · wave E · needs §0, §1.6, T2.B `ImportResult`, T2.C `Sheet` and `Segmented` props, UI.md §7.6
Files: new `src/components/ImportSheet.svelte`, `src/lib/render/warnings.ts`, `warnings.test.ts`; edit `src/components/ImportButton.svelte`, `src/lib/render/smiles.ts`.
```ts
// smiles.ts (still the only file that imports smiles-drawer)
export function checkSmiles(smiles: string): Promise<string | null>; // error message or null; never rejects
// warnings.ts
export interface RenderWarning { line: number; side: 'front' | 'back'; raw: string; message: string }
export function mathWarnings(src: string): { raw: string; message: string }[];
export function sampleWarnings(sample: ImportSample[]): Promise<RenderWarning[]>;
```
- `mathWarnings`: `tokenize(src)`, and for each math token call `katex.renderToString` with the same options as `render.ts`; collect `{ raw, message }` for each throw. `sampleWarnings` runs it on both sides of each sample card and `checkSmiles` on each smiles token (each distinct SMILES string once).
- `checkSmiles`: lazy `import('smiles-drawer')`, `SD.parse(smiles, () => resolve(null), (e) => resolve(message))`, wrapped in try/catch.
- `ImportButton.svelte`: the button now only opens the sheet: `<ImportSheet bind:open {deckName} />`. Remove the file input, `summarize` and the result alert.
- `ImportSheet.svelte`: `let { open = $bindable(false), deckName = null }: { open?: boolean; deckName?: string | null } = $props();`
  - Source: `Segmented` "File" / "Paste". File shows a "Choose File…" button (hidden `<input type="file" accept=".jsonl,.json,.txt">`) and the chosen name. Paste shows a monospace `<textarea class="field">` (`data-autofocus`).
  - "Default deck" text field, prefilled with `deckName`, else the file name without extension, else `Imported`; caption "Used for cards without a deck field."
  - The import file is the chosen `File`, or `new File([text], 'Pasted text', { type: 'text/plain' })`.
  - Preview: `call('import.run', { file, defaultDeck, commit: false })`, run when a file is chosen, 400 ms after the pasted text or default deck stops changing, with a generation counter to drop stale results. Then `sampleWarnings(result.sample)`.
  - Preview body per UI.md §7.6: three counts (New, Duplicates, Errors); the deck table (name, added, a `.badge` "New" when `isNew`); errors as "Line N: message" with "and M more" when `errorCount > errors.length`; warnings as "Line N, front: message" under the heading "Rendering warnings (first 20 cards checked)". Warnings never block the import.
  - Footer: "Cancel" and a `.btn-primary` "Import N Cards" (disabled while previewing or when `added` is 0). Import runs the same call with `commit: true`, then `refreshDecks()` and closes. A rejected call shows `Alert` "Import Failed" with the message and keeps the sheet open. Closing resets all state.
- Tests: `mathWarnings` for a clean string, bad LaTeX, bad `\ce`, and two errors in one string.
- Check: `npx vitest run src/lib/render && npm run check`

### T2.4 Card and deck editor · wave G · needs §0, T2.B types, T2.C `Sheet` props, UI.md §7.7, `RichText` props, `ExportButton` props from T2.6
Files: new `src/components/CardEditorSheet.svelte`, `DeckNameSheet.svelte`; edit `DeckView.svelte`, `CardList.svelte`, `Sidebar.svelte`.
- `CardEditorSheet.svelte`:
  ```ts
  let { open = $bindable(false), card = null, deckId, onsaved }: {
    open?: boolean; card?: Card | null; deckId: number; onsaved?: (card: Card) => void } = $props();
  ```
  `card` null means a new card in `deckId`. A wide `Sheet`, title "New Card" or "Edit Card". Left column: Deck `<select class="field">` from `deckStore.decks`; Front and Back `<textarea class="field">` (Front has `data-autofocus`); Tags text field (split on commas and whitespace). Right column "Preview": `<RichText>` for the front, a hairline, `<RichText>` for the back, fed from copies of the text that update 150 ms after typing stops. Footer: "Cancel", `.btn-primary` "Save" (disabled when front or back is blank). Save calls `card.create` or `card.update`; on success `onsaved(card)` and close; on failure show the message in a `.field-error` line and stay open. Ctrl/⌘+Enter saves.
- `DeckNameSheet.svelte`: `let { open = $bindable(false), deck = null, onsaved }: { open?: boolean; deck?: { id: number; name: string } | null; onsaved?: (id: number) => void } = $props();` Title "New Deck" or "Rename Deck", one text field (`data-autofocus`, Enter saves), "Cancel" and "Create" or "Rename". Calls `deck.create` or `deck.rename`, then `refreshDecks()`, `onsaved(id)`, close. Errors inline.
- `Sidebar.svelte`: a `.btn-icon` (Lucide `Plus`, "New Deck") at the right of the "Decks" header; opens `DeckNameSheet`; `onsaved` goes to the new deck.
- `CardList.svelte`: Enter with exactly one selected row calls `onopen` with that card.
- `DeckView.svelte`: toolbar gains, before Import, `.btn-icon` buttons `Plus` "New Card", `Pencil` "Rename Deck…", and `<ExportButton {deckId} />`. `onopen` opens the editor with that card. `onsaved` runs `refreshDecks()` and bumps an `edits` counter that is appended to `refreshKey`. Key `N` opens a new card when no field, list or dialog has focus.
- Check: `npm run check`

### T2.5 Undo last review · wave E · needs §0, §1.5, T2.B `study.undo`
Files: `src/lib/session.ts`, `session.test.ts`, `src/components/StudyView.svelte`.
```ts
// added to StudySession<T>
get canUndo(): boolean;
undo(): { card: T; persisted: boolean } | null;
```
- `answer` saves a one-step snapshot first: a copy of the queue, the card, and whether this answer was persisted. `undo` restores the queue, removes the card id from `answeredIds` when `persisted`, clears the snapshot and returns `{ card, persisted }`; with no snapshot it returns null. `push` leaves the snapshot alone.
- `StudyView.svelte`: keep `lastSave: Promise<AnswerResult> | null`, set in `answer` when `persist` (null otherwise). `undo()`: `const u = session.undo()`; return if null; `revealed = false`; `sync()`; if `u.persisted`, await `lastSave`, then `call('study.undo', { reviewId })`; a failure sets `saveError` to "Couldn't undo the last answer: …". Keep `canUndo` in `$state`, refreshed in `sync()`.
- Keys: move the Ctrl/⌘+Z test above the modifier guard in `onKeydown`: `(ctrlKey || metaKey) && !altKey && !shiftKey && key.toLowerCase() === 'z'` outside an editable target and with no open dialog calls `preventDefault()` and `undo()`. Plain `U` does the same. Both work in the done state.
- Toolbar: a `.btn-toolbar` "Undo" (Lucide `Undo2`) before "Done", disabled when `!canUndo`. The done state also shows the button, so the last answer can be undone.
- Tests: undo after a right answer restores the head and `answered`; undo after a wrong answer removes the reinserted copy; undo of a repeat answer gives `persisted: false`; a second undo returns null; `canUndo` transitions.
- Check: `npx vitest run src/lib/session.test.ts && npm run check`

### T2.6 Export · wave E · needs §0, T2.B `export.jsonl`, `Alert` props
Files: new `src/components/ExportButton.svelte`; edit `src/App.svelte`.
- `let { deckId = null }: { deckId?: number | null } = $props();` A `.btn-icon` (Lucide `FileUp`); `aria-label` and `title` are "Export Deck…" for a deck and "Export All Decks…" for null. Click: `const blob = await call('export.jsonl', { deckId })`, then save through a temporary `<a download>` on `URL.createObjectURL(blob)` and revoke the URL. File name: the deck name with characters outside `[\p{L}\p{N} ._-]` replaced by `_`, plus `.jsonl`; for all decks `leitner-box-YYYY-MM-DD.jsonl` (local date). Disabled while running. A rejected call shows `Alert` "Export Failed".
- `App.svelte`: in the home toolbar, `<ExportButton />` before `ImportButton` when `deckStore.decks.length > 0`.
- Check: `npm run check` (the round-trip test is in T2.B)

### T2.7 PWA and offline · wave E · needs §0
Files: `vite.config.ts`, `index.html`, `src/main.ts`, new `public/manifest.webmanifest`, `public/icon.svg`, `public/sw-template.js`.
- `public/icon.svg`: 512 × 512 viewBox, a `#007AFF` rounded square (`rx="112"`) with three white stacked card outlines, stroke 24, no gradient.
- `manifest.webmanifest`: `name` and `short_name` "Leitner Box", `start_url: "./"`, `scope: "./"`, `display: "standalone"`, `background_color: "#FFFFFF"`, `theme_color: "#FFFFFF"`, `icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]`.
- `index.html`: `<link rel="manifest" href="./manifest.webmanifest">`, `<link rel="icon" href="./icon.svg" type="image/svg+xml">`, and `theme-color` metas for light (`#FFFFFF`) and dark (`#1E1E1E`).
- `sw-template.js`: `const VERSION = '__VERSION__'; const FILES = __FILES__;` Install: open cache `leitner-${VERSION}`, `addAll(FILES)`, `skipWaiting()`. Activate: delete other `leitner-*` caches, `clients.claim()`. Fetch: same-origin GET only; cache first with `ignoreSearch`, then network, storing successful responses; a navigation request that fails falls back to the cached `./index.html`.
- `vite.config.ts`: an inline plugin `swManifest()` with `apply: 'build'` and a `closeBundle` hook: list every file under `dist/` recursively, skip `sw.js`, `sw-template.js`, `*.map`, `*.ttf` and `*.woff` (keep `*.woff2`); `VERSION` is the first 12 hex chars of a SHA-256 over the sorted paths and file contents; write `dist/sw.js` from the template with `FILES` as `./`-relative paths plus `./`; delete `dist/sw-template.js`.
- `main.ts`: after mount, `if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js').catch(() => {});`. Keep the existing `persist()` call.
- Check: `npm run build && node -e "const s=require('fs').readFileSync('dist/sw.js','utf8');process.exit(/\.wasm/.test(s)&&/index\.html/.test(s)&&!s.includes('__FILES__')?0:1)"`
- Orchestrator, after the check: `npm run preview`, load once, go offline in devtools, reload; import, study and reload again. Confirm the install prompt in Chromium; if the SVG-only icon blocks install, issue a follow-up card for PNG icons.

### T2.8 100k performance check · alone, after wave G · needs §0, T2.B types
Files: new `scripts/gen-cards.mjs`, `src/lib/bench.ts`; edit `src/main.ts`, `.gitignore`.
- `gen-cards.mjs`: `node scripts/gen-cards.mjs <count> [decks=10] > file.jsonl`. Deterministic (mulberry32, seed 1). Every card is unique (the index is in the front). About 20% have inline math, 5% display math, 5% `\\ce{…}`, 2% `{{smiles:…}}` from a list of 20 valid SMILES; 1 to 3 tags from 30; decks named `Bench 01` and up, sizes skewed so the first holds about 40%.
- `bench.ts`: `export async function runBench(url = './bench.jsonl'): Promise<Record<string, number>>`, also set as `window.__bench`. It fetches `url`, wraps it as a `File`, and times with `performance.now()` (median of 20 runs unless noted): `import.run` commit (once); `deck.list`; `card.list` first page and tenth page on the largest deck; `card.list` with a common one-term search, a rare term and a two-term search; `card.count` for the same; `study.due` with limit 20; `renderToHtml` on 20 uncached math cards (mean per card). Prints `console.table` and returns the object. Also `window.__benchScroll()`: scrolls the card list by 1500 px per frame for 3 s and returns the worst frame time and the share of frames over 20 ms.
- `main.ts`: `if (new URLSearchParams(location.search).has('bench')) void import('./lib/bench');`. `.gitignore`: `bench/`.
- Check: `node scripts/gen-cards.mjs 1000 | node -e "let n=0;require('readline').createInterface({input:process.stdin}).on('line',l=>{JSON.parse(l);n++}).on('close',()=>process.exit(n===1000?0:1))" && npm run check`
- Orchestrator: generate 50k and 100k files into `bench/`, `npm run build`, copy one to `dist/bench.jsonl`, `npm run preview`, open `?bench` in Chromium, run `__bench()` on a fresh profile for each file and `__benchScroll()` on the largest deck. Record every number against its CLAUDE.md target in STATUS.md. For each miss issue a fix card; first candidates: drop the FTS triggers during import and rebuild the index once at the end; a per-deck counts table for `deck.list` (a schema change, so its own card).

### T2.9 HIG audit · orchestrator, last
Walk every screen in UI.md §6 and §7 against the §8 checklist in light and dark, with increased contrast, with reduced motion, and keyboard-only, in Chromium and Firefox. Correct UI.md where the built app is right and the spec is stale. List each finding as one line in STATUS.md and issue one fix card per screen. Finish with `npm run test && npm run check && npm run build`.

## 4. Tier 3 cards: daily reminders and habit

Source: `docs/PLAN-T3-REMINDERS.md` (context and contracts); UI spec in `docs/UI.md` §7.13. No new dependencies.

### Order and parallelism
```
T3.A (done, orchestrator)
wave H  parallel:  T3.1  T3.2  T3.3
wave I  alone:     T3.4            (after wave H)
wave J  alone:     T3.5            (after T3.4)
then    T3.6 (orchestrator)
```
T3.2 type-imports `DayRecord` from `types.ts`, which T3.1 adds in the same wave; vitest strips type imports, and `npm run check` runs after the wave.

### 4.1 Contracts (fixed)

**`types.ts` additions (verbatim).**
```ts
// DeckSummary gains:  remind: boolean;
export interface DayRecord { day: number; reviewed: number; cleared: boolean; planned: number | null }
export interface DeckForecast { deckId: number; name: string; byDay: number[] } // length 31; [0] = due today incl. overdue, [i] = due_day == today+i
export interface HabitSummary {
  today: number;
  days: DayRecord[];        // rows with today-365 <= day <= today, ascending
  secondsPerCard: number;
  forecast: DeckForecast[]; // every reminded deck (also those with nothing due), by name NOCASE
}
// Api gains:
'deck.setRemind': { req: { id: number; remind: boolean }; res: null };
'habit.summary':  { req: null; res: HabitSummary };
```

**Schema v2** (`schema.ts` exports `SCHEMA_V2`, verbatim; the backfill is separate because it binds the time zone):
```sql
ALTER TABLE decks ADD COLUMN remind INTEGER NOT NULL DEFAULT 1;
CREATE TABLE days(
  day INTEGER PRIMARY KEY,
  reviewed INTEGER NOT NULL DEFAULT 0,
  cleared INTEGER NOT NULL DEFAULT 0,
  planned INTEGER);
CREATE INDEX reviews_time ON reviews(reviewed_at);
PRAGMA user_version = 2;
```
Backfill (also exported, as `BACKFILL_DAYS`): `INSERT INTO days(day, reviewed, cleared) SELECT (reviewed_at - ? * 60000) / 86400000, COUNT(*), 1 FROM reviews GROUP BY 1` bound to `[tzOffsetMin]`.

**Habit semantics.**
- *Reminded due* (today): `SELECT EXISTS(SELECT 1 FROM cards c JOIN decks d ON d.id = c.deck_id WHERE d.remind = 1 AND c.due_day <= ?)`.
- *Answer*: `INSERT INTO days(day, reviewed, cleared) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET reviewed = reviewed + 1, cleared = MAX(cleared, excluded.cleared)` with `cleared = remindedDue ? 0 : 1`. `cleared` is sticky within a day except through undo.
- *Undo*: the review's day is `dayNumber(reviewed_at, tzOffsetMin)`. `UPDATE days SET reviewed = MAX(reviewed - 1, 0) WHERE day = ?`; if that day is today, also set `cleared = remindedDue ? 0 : 1` (not sticky).
- *Summary*: forecast from `SELECT c.deck_id, MAX(c.due_day - ?today, 0), COUNT(*) FROM cards c JOIN decks d ON d.id = c.deck_id WHERE d.remind = 1 AND c.due_day <= ?today + 30 GROUP BY 1, 2`, merged into every reminded deck (`SELECT id, name FROM decks WHERE remind = 1 ORDER BY name COLLATE NOCASE, id`). In one transaction: if the total of `byDay[0]` is 0, upsert today with `cleared = 1`; upsert `planned` for today+1 … today+30 with the per-day total over reminded decks (`INSERT INTO days(day, planned) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET planned = excluded.planned`); insert today with `planned = byDay[0] total` only if its `planned` is NULL. Then read `days` for `today-365 … today`.
- *secondsPerCard*: the last 300 `reviewed_at` values (`ORDER BY reviewed_at DESC`, uses `reviews_time`); gaps between neighbours that are `> 0` and `< 120000` ms; fewer than 5 gaps gives `8`; else the median gap in seconds, clamped to `3..60`, rounded to 0.1.
- *Streak* (`computeStreak(days, today)`): `kept(d)` = row cleared; `rest(d)` = row exists, `planned === 0`, not cleared; else missed (including no row). Start at `today` if kept, else `today - 1`. Walk back while `d >= firstRowDay`: kept or rest continues; missed is forgiven if no forgiven day lies in `d+1 … d+6`, else stop. Then trim from the oldest end every day that is not kept (rest or forgiven), so the run ends on a kept day. `length` = days in the run (0 if none kept); `forgiven` = forgiven days inside it, descending.
- *Rhythm* (`rhythmCells(days, today)`): 84 cells from the Monday 11 weeks before today's week (`weekday(d) = (d + 3) % 7`, 0 = Monday) through that week's Sunday, ascending. Status: `d > today` future; kept → kept; `d === today` → none; rest → rest; in `computeStreak(...).forgiven` → forgiven; else missed. Level: kept only, from `reviewed`: 0 → 1, ≤ 10 → 1, ≤ 30 → 2, ≤ 60 → 3, else 4; every other status 0.
- `estimateMinutes(due, spc) = Math.max(1, Math.ceil(due * spc / 60))`; 0 due gives 0.

**Reminders core** (`src/lib/reminders/core.ts`, ported by hand into the SW):
```ts
export interface ReminderPrefs { time: string; notify: boolean }     // "HH:MM"
export const DEFAULT_PREFS: ReminderPrefs = { time: '19:00', notify: false };
export interface SnapshotDeck { id: number; name: string; byDay: number[] }
export interface Snapshot {
  day: number; time: string; notify: boolean; streak: number; secondsPerCard: number;
  decks: SnapshotDeck[]; notifiedDay: number | null;
}
export function dueOn(s: Snapshot, today: number): { id: number; name: string; due: number }[];
//   k = clamp(today - s.day, 0, 30); due = sum(byDay[0..k]); only due > 0; due desc, then name
export function minutesOfDay(time: string): number;                  // "19:05" -> 1145; invalid -> 1140
export function shouldNotify(s: Snapshot, nowMs: number, tzOffsetMin: number): boolean;
//   today = dayNumber(nowMs, tz); local minute = floor(((nowMs - tz*60000) mod 86400000) / 60000) (positive mod)
//   s.notify && dueOn(s, today) non-empty && minute >= minutesOfDay(s.time) && s.notifiedDay !== today
export function notificationText(s: Snapshot, today: number): { title: string; body: string };
//   title 'Leitner'; parts = first 3 decks as `${name} ${due.toLocaleString()}`, plus `${k} more` if more;
//   body = `${parts.join(' · ')} · about ${max(1, ceil(total*spc/60))} min.` + (streak >= 2 ? ` Keep your ${streak}-day streak going.` : '')
```

### T3.1 DB: schema v2, remind flag, days, habit summary · wave H · needs §0, §4.1 (types, schema, habit semantics), §1.5
Files: `src/lib/db/types.ts`, `schema.ts`, `ops.ts`, `card-ops.ts`, `worker.ts`, new `src/lib/db/habit-ops.ts`, `habit-ops.test.ts`.
- `types.ts`: the §4.1 additions verbatim.
- `schema.ts`: export `SCHEMA_V2` and `BACKFILL_DAYS` verbatim.
- `ops.ts`: `migrate(db, tzOffsetMin = new Date().getTimezoneOffset())`: version 0 runs V1 then V2 + backfill in one transaction; version 1 runs V2 + backfill in a transaction. `listDecks` selects `d.remind` and sets `remind: num(remind) === 1`. `answerCard` calls `recordAnswer(db, today)` inside its transaction, after the review insert.
- `habit-ops.ts` (must not import from `ops.ts` or `card-ops.ts`; use `Number()`; `dayNumber` from `../leitner`):
  ```ts
  export function remindedDue(db: Database, today: number): boolean;
  export function recordAnswer(db: Database, today: number): void;
  export function recordUndo(db: Database, reviewedAt: number, today: number, tzOffsetMin: number): void;
  export function setRemind(db: Database, id: number, remind: boolean): void;   // unknown id throws 'Deck not found'
  export function habitSummary(db: Database, today: number): HabitSummary;
  ```
- `card-ops.ts`: `undoReview(db, reviewId, tzOffsetMin = new Date().getTimezoneOffset())`; inside its transaction, after restoring the card, read `reviewed_at` (already selected or select it) and call `recordUndo(db, reviewedAt, dayNumber(Date.now(), tzOffsetMin), tzOffsetMin)`.
- `worker.ts`: `'deck.setRemind': (db, args) => { setRemind(db, args.id, args.remind); return null; }`, `'habit.summary': (db) => habitSummary(db, today())`.
- `habit-ops.test.ts` (same in-memory setup as `ops.test.ts`): fresh DB has `user_version` 2 and decks default `remind` true; a v1 DB (run `SCHEMA_V1` by hand, insert reviews on two days at tz 0, then `migrate(db, 0)`) gains `days` rows with the right counts and `cleared = 1`; answering every due card sets today's `cleared`, answering one of two leaves it 0; undo of the last answer decrements `reviewed` and un-clears; a deck with `remind` off doesn't block `cleared`; `setRemind` unknown id throws; `habitSummary` forecast equals a brute-force count per deck and day over 300 random cards, writes `planned` for the next 30 days, and `secondsPerCard` is 8 with few reviews and the median otherwise.
- Check: `npx vitest run src/lib/db && npm run check`

### T3.2 Habit logic · wave H · needs §0, §4.1 (`DayRecord`, streak, rhythm, estimate)
Files: new `src/lib/habit.ts`, `src/lib/habit.test.ts`.
```ts
import type { DayRecord } from './db/types';
export type CellStatus = 'kept' | 'rest' | 'forgiven' | 'missed' | 'future' | 'none';
export interface RhythmCell { day: number; status: CellStatus; level: 0 | 1 | 2 | 3 | 4 }
export function computeStreak(days: DayRecord[], today: number): { length: number; forgiven: number[] };
export function rhythmCells(days: DayRecord[], today: number): RhythmCell[];
export function estimateMinutes(due: number, secondsPerCard: number): number;
```
- Tests: empty history gives 0; today kept vs not yet kept (start yesterday); rest days count and don't break; one missed day forgiven, a second within 6 days stops, a second 7+ days later is forgiven too; a run that would start with a forgiven or rest day is trimmed; a missing row counts as missed; 84 cells, first is a Monday, last is a Sunday, today's status is `none` until kept, future cells after today; levels at 0, 10, 11, 61 reviewed; `estimateMinutes(0, 8) === 0`, `(1, 8) === 1`, `(42, 8) === 6`.
- Check: `npx vitest run src/lib/habit.test.ts`

### T3.3 Reminders core, store, ICS, service worker · wave H · needs §0, §4.1 (reminders core), PLAN-T3 "Service worker"
Files: new `src/lib/reminders/core.ts`, `core.test.ts`, `store.ts`, `ics.ts`, `ics.test.ts`; edit `public/sw-template.js`.
- `core.ts`: §4.1 verbatim; imports only `dayNumber` from `../leitner`.
- `store.ts`: IndexedDB `leitner-reminders` version 1, object store `kv` (out-of-line keys), keys `prefs` and `snapshot`. Every function catches all errors (also missing `indexedDB`) and resolves:
  ```ts
  export function getPrefs(): Promise<ReminderPrefs>;              // DEFAULT_PREFS on miss or error
  export function setPrefs(p: ReminderPrefs): Promise<void>;
  export function getSnapshot(): Promise<Snapshot | null>;
  export function writeSnapshot(s: Omit<Snapshot, 'notifiedDay'>): Promise<void>; // one readwrite tx; keeps the stored notifiedDay (null if none)
  export function markNotified(day: number): Promise<void>;        // sets snapshot.notifiedDay if a snapshot exists
  ```
- `ics.ts`: `export function buildIcs(o: { time: string; url: string; deckNames: string[]; now: Date }): string`. Lines: `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//Leitner//Reminders//EN`, `CALSCALE:GREGORIAN`, `BEGIN:VEVENT`, `UID:leitner-daily@leitner`, `DTSTAMP:` (UTC `YYYYMMDDTHHMMSSZ` of `now`), `DTSTART:` (floating local, the day after `now` at `time`, `YYYYMMDDTHHMM00`), `DURATION:PT15M`, `RRULE:FREQ=DAILY`, `SUMMARY:Leitner review`, `DESCRIPTION:` (`Review your due cards` + (names ? `: ${names.join(', ')}` : '') + `.\n${url}`), `URL:${url}`, `BEGIN:VALARM`, `ACTION:DISPLAY`, `DESCRIPTION:Leitner review`, `TRIGGER:PT0M`, `END:VALARM`, `END:VEVENT`, `END:VCALENDAR`. TEXT values escape `\` `;` `,` and newline (`\n`). Join with CRLF, end with CRLF. Fold any line over 75 UTF-8 octets: CRLF + one space, never splitting a code point.
- `sw-template.js`: append a block headed `// Reminders: keep in sync with src/lib/reminders/core.ts` with plain-JS ports of `dayNumber`, `minutesOfDay`, `dueOn`, `shouldNotify`, `notificationText`, and a tiny IndexedDB helper (`idbGet(key)`, `idbPut(key, value)` on `leitner-reminders`/`kv`, creating the store in `onupgradeneeded`). Handlers:
  - `periodicsync`, `event.tag === 'leitner-daily'`: `event.waitUntil` reading the snapshot; if `shouldNotify(s, Date.now(), new Date().getTimezoneOffset())`, `self.registration.showNotification(title, { body, tag: 'leitner-daily', icon: 'icon.svg', actions: [{ action: 'start', title: 'Start Review' }] })`, then set `notifiedDay = today` and put it back.
  - `notificationclick`: close it; `url = self.registration.scope + '#/today'`; `clients.matchAll({ type: 'window', includeUncontrolled: true })`; with a client, `focus()` then `navigate(url)` (if `navigate` rejects, `postMessage({ type: 'route', hash: '#/today' })`); else `clients.openWindow(url)`.
- `core.test.ts`: `dueOn` accumulates over skipped days and clamps at 30; `shouldNotify` false before the time, true at it, false once notified today, false with notify off or nothing due, correct across tz offsets −330 and +300 and near midnight; `notificationText` with 1 and 5 decks and streak 1 vs 12. `ics.test.ts`: every line ends in CRLF, no line over 75 octets, a long non-ASCII description unfolds back to the original, DTSTART is tomorrow, `RRULE:FREQ=DAILY` and the UID are present, commas and semicolons are escaped.
- Check: `npx vitest run src/lib/reminders && node --check public/sw-template.js`

### T3.4 Today view, sidebar, reminders sheet, runtime · wave I · needs §0, §4.1, UI.md §7.13, `Sheet` props (`open` bindable, `title`, `onclose`, `wide`), §7.12
Files: `src/lib/router.svelte.ts`, `router.test.ts`, `src/App.svelte`, `src/components/Sidebar.svelte`, `src/lib/decks.svelte.ts`, `src/styles/tokens.css`, `src/styles/base.css`; new `src/components/TodayView.svelte`, `RemindersSheet.svelte`, `RhythmGrid.svelte`, `src/lib/habit.svelte.ts`, `src/lib/reminders/reminders.svelte.ts`.
- Router: `Route` gains `{ name: 'today' }` (`#/today`) and `study` becomes `{ name: 'study'; deckId: number; limit?: number }` ↔ `#/study/3?n=10` (`n` is an integer 1…1000, else dropped). Tests: round-trip both, bad `n` dropped.
- `habit.svelte.ts`: `export const habitStore: { summary: HabitSummary | null; error: string | null } = $state(...)`; `export async function refreshHabit(): Promise<void>` calls `habit.summary`, stores it, then `syncReminders(summary)`; `export function startHabit(): void` (call once from `App.svelte` mount) runs `refreshHabit`, re-runs `refreshDecks` on `visibilitychange` to visible and at the next local midnight + 1 s (re-armed each time).
- `decks.svelte.ts`: `refreshDecks` calls `void refreshHabit()` after a successful load.
- `reminders.svelte.ts`:
  ```ts
  export const reminders: { prefs: ReminderPrefs; permission: NotificationPermission | 'unsupported';
    support: { notify: boolean; periodic: boolean; badge: boolean } } = $state(...);
  export async function loadReminders(): Promise<void>;           // getPrefs + detect support/permission
  export async function savePrefs(p: ReminderPrefs): Promise<void>;// setPrefs, then syncReminders(last summary)
  export async function syncReminders(s: HabitSummary): Promise<void>;
  export async function enableNotifications(): Promise<boolean>;   // must run in the click handler
  export function downloadIcs(deckNames: string[]): void;
  ```
  Support: `notify = 'Notification' in window && 'serviceWorker' in navigator`; `periodic = 'serviceWorker' in navigator && 'periodicSync' in ServiceWorkerRegistration.prototype`; `badge = 'setAppBadge' in navigator`. `syncReminders`: `writeSnapshot({ day: s.today, time, notify, streak: computeStreak(s.days, s.today).length, secondsPerCard, decks: forecast mapped to { id: deckId, name, byDay } })`; badge = sum of `byDay[0]` (`setAppBadge(n)` or `clearAppBadge()`, errors ignored); clear the old timer and, if notify and the reminder time today is still ahead, `setTimeout` to it, which reads `getSnapshot()` and, when `shouldNotify`, shows the notification through `(await navigator.serviceWorker.ready).showNotification` (same options as the SW) and `markNotified(today)`. `enableNotifications`: `Notification.requestPermission()`; if granted and `periodic`, `reg.periodicSync.register('leitner-daily', { minInterval: 12 * 3600 * 1000 })` in a try/catch; returns whether granted. `downloadIcs`: `buildIcs({ time, url: location.origin + location.pathname + '#/today', deckNames, now: new Date() })` as `text/calendar`, file `leitner-reminder.ics`, URL revoked after 1 s. Also listen for SW `message` `{ type: 'route', hash }` and set `location.hash`.
- `App.svelte`: call `startHabit()` and `loadReminders()` on mount; render `TodayView` for `today`; when the route is `home`, decks are loaded and non-empty, `go({ name: 'today' })`.
- `Sidebar.svelte`: the Today row first in the listbox, per UI §7.13.
- `TodayView.svelte`, `RhythmGrid.svelte` (props `{ days: DayRecord[]; today: number }`), `RemindersSheet.svelte` (props `{ open: boolean (bindable) }`): per UI §7.13. Due counts come from `deckStore` (`remind && due > 0`, due desc); minutes from `estimateMinutes(total, summary.secondsPerCard ?? 8)`; tomorrow from the sum of `forecast[].byDay[1]`. Start Review goes to the first listed deck; Just 10 adds `limit: 10`. The sheet's deck checkboxes call `deck.setRemind` then `refreshDecks()`; the notify checkbox calls `enableNotifications()` when turned on and stays off if not granted; time changes call `savePrefs` on `change`.
- `tokens.css` / `base.css`: the UI §7.13 tokens and classes.
- Check: `npm run check && npx vitest run src/lib/router.test.ts`

### T3.5 Study and deck hooks · wave J · needs §0, UI.md §7.13 (Deck view, Study end), `refreshHabit`/`habitStore` from T3.4, `deckStore`/`refreshDecks`
Files: `src/components/StudyView.svelte`, `src/components/DeckView.svelte`, `src/App.svelte`.
- `StudyView`: new prop `limit?: number`. With a limit, the session deals at most `limit` distinct cards (each `study.due` asks for `min(PAGE, limit - fetched)` and stops at the limit); "of M" uses `min(due, limit)`. On reaching the end screen, `await refreshDecks()` (which refreshes habit), then show the next-deck button or the done line per UI §7.13. The next candidate is the reminded deck with the most due (the current deck counts); clicking goes to `{ name: 'study', deckId }`.
- `DeckView`: the Remind Me Daily button per UI §7.13; click calls `deck.setRemind` with the toggled value, then `refreshDecks()`.
- `App.svelte`: pass `limit={route.limit}` to `StudyView`; key on `route.deckId` and `route.limit`.
- Check: `npm run check`

### T3.6 Verify and audit · orchestrator
As in `docs/PLAN-T3-REMINDERS.md`: `npm run test && npm run check && npm run build`; Chrome notification and `notificationclick` check with throwaway playwright-core; Firefox calendar and in-app paths; `habit.summary` < 20 ms and `study.answer` at 100k; §8 audit on Today, Reminders sheet and study end; decisions in STATUS.
