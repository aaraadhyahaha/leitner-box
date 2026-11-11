# Status

## Tier 1 (MVP)
- [x] T1.1 Scaffold and contracts
- [x] T1.2 Leitner and session logic (wave A)
- [x] T1.3 Import parser (wave A)
- [x] T1.4 Rendering (wave A)
- [x] T1.5 Tokens, base styles, Alert, Toolbar (wave A)
- [x] T1.6 Import format doc and sample file (wave A)
- [x] T1.7 Database worker, operations and client
- [x] T1.8 App shell, sidebar, import, deck view (wave C)
- [x] T1.9 Study view (wave C)
- [x] T1.10 MVP smoke test: import, study and persistence pass in headless Chrome (T2.7 run).

## Tier 2
Waves: D = T2.B, T2.C in parallel. E = T2.1, T2.3, T2.5, T2.6, T2.7 in parallel. F = T2.2. G = T2.4. Then T2.8, T2.9.
- [x] T2.A Extend UI.md (§7 screens, §8 audit checklist)
- [x] T2.B API contract and DB ops (wave D)
- [x] T2.C UI primitives: tokens, Sheet, Segmented, SearchField (wave D)
- [x] T2.1 Card list, search, box filter (wave E)
- [x] T2.2 Bulk delete and Imports (wave F)
- [x] T2.3 Import preview sheet (wave E)
- [x] T2.4 Card and deck editor (wave G)
- [x] T2.5 Undo last review (wave E)
- [x] T2.6 Export (wave E)
- [x] T2.7 PWA and offline: verified in headless Chrome 157 (offline reload, import, study; update toast)
- [x] T2.8 100k performance check (numbers below)
- [x] T2.9 HIG audit: headless Chrome 157, light/dark, increased contrast, reduced motion, keyboard only (fixes below; Firefox not re-run)

## Performance (T2.8)
Headless Chrome 157, production build, fresh profile, 100k cards in 10 decks (largest 39,709). Medians of 20 runs, measured on the main thread around `call()` (includes the worker round trip). Rerun: `npm run build`, `npm run preview`, open `/?perf`, then `__perf.importFile(file)`, `__perf.queries()`, `__perf.scroll()` (see `src/lib/perf.ts`).

| Metric | Target | Before | After |
|---|---|---|---|
| Import 50k, empty library | < 3 s | 3,311 ms | 1,591 ms |
| Import 50k on top of 100k | < 3 s | 3,534 ms | 1,607 ms |
| Import 100k, empty library | (none) | 6,629 ms | 3,148 ms |
| Re-import 100k (all duplicates) | (none) | 2,154 ms | 2,202 ms |
| Delete a 50k import batch | (none) | 410 ms | 665 ms |
| Deck list | < 20 ms | 15.3 ms | 17.1 ms |
| Card list page 1 / page 10 (200 rows) | < 15 ms | 1.8 / 2.0 ms | 2.1 / 3.0 ms |
| Search, common term (`energy`, ~85% of cards) | < 15 ms | 29.9 ms | 7.0 ms |
| Search, two terms / rare term | < 15 ms | 23.7 / 0.5 ms | 8.2 / 0.5 ms |
| "N matching" count, common term | (none) | 26.2 ms | 27.7 ms, now queued after the page |
| Next study card: render front + back | < 16 ms | 0.59 ms | 0.59 ms |
| Next study card: `study.answer` / `study.due` 20 | < 16 ms | 0.6 / 0.5 ms | 0.5 / 0.3 ms |
| List scrolling, 400 px per frame for 5 s | 60 fps | stuck after 200 rows (paging bug) | 120,400 px (22 pages), worst frame 16.8 ms, 0% over 20 ms |

## HIG audit fixes (T2.9)
- Counts had no thousands separators (deck subtitle, sidebar badge, segments, selection/matching, import preview, Imports view, study counter and summary): new `src/lib/format.ts` (`fmt`, `count`).
- Import sheet opened from the home empty state inherited `text-align: center`: `.sheet` resets it.
- `.empty-state .btn` margin leaked into sheet buttons (file name misaligned): now `.empty-state > .btn`.
- Search "Clear" button was 20 px: hit area is now the 28 px field height, glyph unchanged.
- Study answer edge had a 24 px glow (no glows allowed): removed, 2 px edge kept as `--edge-width`.
- Increased contrast didn't raise `--label-tertiary` (footnotes, placeholders): now alpha 0.55.
- Disabled opacity was a raw `0.4` in base.css: now `--opacity-disabled`.
- Truncated text without a tooltip: toolbar subtitle, import file name and preview deck names now have `title`.
- Title case: "Clear search" → "Clear Search"; Imports row delete button is "Delete Import…" (opens an alert).
- Straight apostrophes in "Couldn't …" (App, study view): now ’ like the rest.
- App name was "Leitner Box" in toolbars and "Leitner" in the manifest: now "Leitner" everywhere.
- Checked, no change: every destructive action (cards, deck, import batch) confirms with Cancel focused; focus ring is a solid 3 px on every control; every list has an empty state; Esc closes sheets and alerts; reduced motion crossfades the study card.
- Accepted: segmented-control segments are 26 px inside the 28 px control (as in NSSegmentedControl); the notice toast uses the sheet shadow (UI.md §7.11).

## Decisions (one line each)
- 2026-11-11 Intervals are 1/2/4/8/16 days; new cards are due on the day they are added.
- 2026-11-11 Days are local calendar days, stored as an integer day number.
- 2026-11-11 Only a card's first answer in a session changes its box; same-session repeats are practice.
- 2026-11-11 A wrong card returns 4 cards later, or last if fewer remain.
- 2026-11-11 Duplicate = same deck and same hash of trimmed front + back (double cyrb53, 28 hex chars).
- 2026-11-11 `import.run` takes `commit`; the Tier 2 preview is the same import rolled back.
- 2026-11-11 A JSON array file is parsed whole in the worker; JSONL is streamed.
- 2026-11-11 Tags are an array in JSONL and the API, space-separated in SQLite.
- 2026-11-11 Card lists order by (due day, id), or by id when searching, so no extra index is needed.
- 2026-11-11 List rows show plain source text; math renders in study mode and the editor preview.
- 2026-11-11 The worker handles one request at a time.
- 2026-11-11 One tab at a time (opfs-sahpool lock); a second tab shows an error state.
- 2026-11-11 Study keys: Space reveal, Right arrow or 2 = Right, Left arrow or 1 = Wrong, Esc exit, U undo.
- 2026-11-11 Bare `\ce{…}` and `\pu{…}` outside `$…$` render as inline math.
- 2026-11-11 DB operations live in `ops.ts` and are tested in Node against in-memory SQLite.
- 2026-11-11 TypeScript pinned to ~6 (6.0.3): svelte-check 4.7.8 doesn't support TS 7 without the tsgo setup.
- 2026-11-11 `src/types/shims.d.ts` declares `*.svelte` modules (needed for `.ts` imports under TS 6); katex ships its own types, so no `@types/katex`.
- 2026-11-11 Import: `tags: null` and `deck: null` count as absent; `StudySession.push` skips ids already queued.
- 2026-11-11 `<dialog>`s need `margin: auto` (the reset zeroes it); Alert syncs `open` on the `close` event too.
- 2026-11-11 A destructive alert with no Cancel focuses the dialog itself, not the button.
- 2026-11-11 SMILES SVG size is set by `width`/`height` attributes, not CSS; `hydrateSmiles` is untested in Node (no DOM), to verify in T1.10.
- 2026-11-11 SQLite WASM runs under Node, so `ops.test.ts` runs for real; worker handlers take `(db, args)` from the init promise.
- 2026-11-11 An import with a blank default deck and no `deck` field goes to deck `Imported`.
- 2026-11-11 Study: Space is captured only while a card is shown; a failed page fetch shows an inline warning and studying continues.
- 2026-11-11 Sidebar is a listbox with one tab stop; row clicks are handled on the listbox (per-option handlers trip svelte a11y warnings).
- 2026-11-11 svelte-check scans ~4.6k files because `@lucide/svelte` ships one .svelte file per icon; acceptable for now.
- 2026-11-11 Tier 2: all worker API changes are in T2.B; additive except `ImportResult` (gains `decks[].isNew` and `sample`). No schema change.
- 2026-11-11 Tier 2 DB ops live in `card-ops.ts`; `ops.ts` only exports helpers and extends `runImport`.
- 2026-11-11 Import warnings are computed on the main thread from a 20-card `sample`; KaTeX stays out of the worker.
- 2026-11-11 The "Imports tab" is a sidebar row opening `#/imports`, not a per-deck tab, because a batch can span decks.
- 2026-11-11 The box-count strip is the box filter (segmented "All / Box 1 to 5" with counts); Study moves to the deck toolbar.
- 2026-11-11 Card list paging is forward-only keyset; loaded rows stay in memory, only visible rows are in the DOM.
- 2026-11-11 `CardQuery` has no `batchId`.
- 2026-11-11 Undo keys are Ctrl/⌘+Z and U (replaces "U undo" above); undo is one level deep.
- 2026-11-11 PWA uses a hand-written service worker built by a Vite plugin; `vite-plugin-pwa` dropped (Vite 8 peer risk, no new dependency).
- 2026-11-11 Deck create/rename ship in T2.4 with the card editor.
- 2026-11-11 Chromium is not installed; T1.10, T2.7, T2.8 and T2.9 need it, otherwise they run in Firefox only. (Superseded: Google Chrome 157 is installed, see below.)
- 2026-11-11 card-ops SELECTs prefix columns with `c.` (cards_fts has front/back/tags too); create/update run in a transaction; renameDeck on an unknown id throws `Deck not found`.
- 2026-11-11 `card.list` returns `next` whenever a page is full, so an exactly-full last page is followed by one empty page.
- 2026-11-11 `.list-row` focused-selection colours apply only inside a focused `[role="listbox"]`; SearchField Esc stops propagation; Sheet `onclose` fires once per close however it closes.
- 2026-11-11 Export of an unknown deck or a name that sanitises to empty falls back to `leitner-box-YYYY-MM-DD.jsonl`; the object URL is revoked after 1 s for Firefox.
- 2026-11-11 Undo: cards pushed after the snapshot survive; a persisted answer waits for a running `study.undo` so it never lands first; if the original save failed, undo skips the server call.
- 2026-11-11 VirtualList fires `onnearend` even on an empty list; callers guard against duplicate loads. Filter bar and list share a `.deck-body` wrapper; "N matching" also refetches on `refreshKey`.
- 2026-11-11 mhchem throws `[code, message]` arrays, so warnings take the last element; most malformed `\ce` input renders without error. Import is disabled while a preview is pending, so it never commits against a stale preview.
- 2026-11-11 Shift-range in `ids` mode replaces the selection with anchor..index (so Shift+Up/Down can shrink it); list keys act only while the listbox has focus; an `all`-mode Delete waits for the matching count.
- 2026-11-11 DeckView window keys (Enter, `/`, N) are ignored while any dialog is open; the editor's Ctrl/⌘+Enter listener is attached via `$effect` to avoid a svelte a11y warning.
- 2026-11-11 Google Chrome 157 is installed (`/usr/bin/google-chrome-stable`); browser checks use a throwaway playwright-core outside the repo.
- 2026-11-11 PWA: app is named "Leitner"; monochrome SVG icon; the SW plugin lives in `scripts/sw-manifest.mjs` (no @types/node for vite.config.ts).
- 2026-11-11 SW precaches everything except .ttf/.woff, maps, .jsonl and the smiles-drawer chunk, which is runtime-cached on first use.
- 2026-11-11 SW waits (no auto skipWaiting); `Notices.svelte` shows "Update available · Reload", hidden on the study route; Reload posts SKIP_WAITING then reloads on controllerchange.
- 2026-11-11 If `storage.persist()` is refused, a one-time notice suggests exports (flag in localStorage `leitner.persistNoticeShown`).
- 2026-11-11 Bench files are generated by `scripts/gen-cards.mjs` into `bench/` (ignored); `?perf` lazy-loads `src/lib/perf.ts` as `window.__perf`, which logs only when called.
- 2026-11-11 Import drops the `cards_ai` trigger inside its transaction, indexes the batch with one INSERT…SELECT, and recreates it from `sqlite_master` before COMMIT; a preview skips FTS entirely (2.1x faster, schema unchanged).
- 2026-11-11 Search pages order and keyset on `cards_fts.rowid` so FTS5 streams in order (no temp B-tree).
- 2026-11-11 Card list `next` cursor is `$state.raw`: a `$state` proxy can't be posted to the worker, which broke loading page 2.
- 2026-11-11 The "N matching" count starts one task after the list's page request; a common-term count (~28 ms) is accepted since it never delays results.
- 2026-11-11 The service worker ignores `.jsonl`; headless Chrome fails `fetch()` of an 18 MB file, so the harness imports via a file input.
- 2026-11-11 UI.md §7.11 (notices) and §7.12 (text rules: title/sentence case, ellipsis, typographic quotes, `fmt()` for counts) added in T2.9.
