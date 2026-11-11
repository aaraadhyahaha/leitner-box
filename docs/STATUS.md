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
- [ ] T1.10 MVP smoke test (orchestrator)

## Tier 2
- [ ] T2.0 Extend UI.md
- [ ] T2.1 Card list, search, box filter
- [ ] T2.2 Bulk delete
- [ ] T2.3 Import preview sheet
- [ ] T2.4 Deck and card editor
- [ ] T2.5 Undo review
- [ ] T2.6 Export
- [ ] T2.7 PWA and offline
- [ ] T2.8 100k performance check
- [ ] T2.9 HIG audit

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
