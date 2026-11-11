# Status

## Tier 1 (MVP)
- [ ] T1.1 Scaffold and contracts
- [ ] T1.2 Leitner and session logic (wave A)
- [ ] T1.3 Import parser (wave A)
- [ ] T1.4 Rendering (wave A)
- [ ] T1.5 Tokens, base styles, Alert, Toolbar (wave A)
- [ ] T1.6 Import format doc and sample file (wave A)
- [ ] T1.7 Database worker, operations and client
- [ ] T1.8 App shell, sidebar, import, deck view (wave C)
- [ ] T1.9 Study view (wave C)
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
