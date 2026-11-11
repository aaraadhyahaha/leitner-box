# Leitner Box

Local-first web app (runs in the browser, works offline) for Leitner-box flashcards. Minimal feature set, but every feature below is essential and must be solid.

## Roles
- **You (main session, Fable 5.2) orchestrate.** Write the plan in `docs/PLAN.md`: small task cards, each naming the exact files to touch, what to do, and one check command. Keep `docs/STATUS.md` as a checklist plus a one-line-per-decision log.
- **Opus 5.5 executes.** Give each task card to a subagent spawned with `model: "opus"`. Its prompt is the card itself plus the doc sections it needs, so it never has to explore. Run the card's check yourself, then commit. Run cards that don't depend on each other in parallel.
- Make the plan detailed enough that the executor never has to guess. Fix names, data shapes and IPC signatures up front.

## Token discipline
- No `ls -R`, `find .`, `tree`, or grep across the whole repo for small things. Keep a file map in this file and update it as files are added.
- Never read `node_modules/`, `target/`, `dist/` or lockfiles. Don't re-read a file after editing it.
- Use the narrowest check (one test, `npm run check`). Do a full release build only at the end.

## Critical features
1. **Leitner core**: 5 boxes. A correct answer moves the card up one box; a wrong answer sends it to box 1. Intervals are day-based (e.g. 1/2/4/8/16). In a session, wrong cards come back before the session ends. Undo the last review.
2. **Decks & cards**: create, edit and delete both. Each deck shows its count per box and the number due today.
3. **Study mode**: keyboard-first (Space reveals, Right/Wrong keys, Undo, Esc exits).
4. **Search** within a deck (full-text), plus a box filter.
5. **Bulk import**: a file or pasted text in **JSONL** (one card per line; a JSON array also works). Fields: `deck` (optional), `front`, `back`, `tags` (optional).
   - **Preview before committing**: count of valid cards, duplicates skipped, and errors with line numbers.
   - The whole import commits in one transaction.
   - Each import is stored as a **batch** so it can be deleted in one action.
   - Re-importing the same file must be safe: no duplicates.
6. **Bulk delete**: multi-select (click, Ctrl-click, Shift-click range), "select all matching the current search/filter", delete a whole import batch, delete a deck. Every destructive action asks for confirmation.
7. **Export** to the same JSONL format, so cards round-trip and you have backups.
8. **Rendering**:
   - LaTeX via KaTeX: `$…$` inline, `$$…$$` display.
   - mhchem for `\ce{…}`.
   - SMILES via `{{smiles:CCO}}` (optional caption: `{{smiles:CCO|ethanol}}`), drawn as a 2D structure. Load the SMILES library lazily.
   - Everything else is HTML-escaped.
   - A render error is a warning, not a crash.
9. **AI card generation**: write `docs/IMPORT_FORMAT.md` with the format and a copy-paste prompt for an AI agent to generate cards for a named deck. Stress that backslashes must be doubled in JSON (`\\frac`).

Out of scope: sync, accounts, images, audio, stats dashboards, nested decks.

## Performance (must handle 100k+ cards)
- SQLite WASM (`@sqlite.org/sqlite-wasm`) running in a **Web Worker**, stored in OPFS through the `opfs-sahpool` VFS (no COOP/COEP headers needed). Indexes on (deck, due day), and FTS5 for search. Do all bulk writes in one transaction with prepared statements.
- The main thread only renders. All DB work and file parsing happen in the worker, behind one typed request/response API (`src/lib/db/client.ts`). Never block the main thread.
- Never load all cards into the UI. Lists are virtualized and paged by keyset. Cache rendered math.
- Import files go straight to the worker as a `File` object and are parsed there in a stream. Never send the whole text through `postMessage`.
- Call `navigator.storage.persist()` on first run so the browser doesn't evict the data.
- Targets:
  - Deck list < 20 ms
  - Paged search < 15 ms
  - Next study card < 16 ms (pre-render the next few)
  - Importing 50k cards < 3 s
  - 60 fps scrolling
- Write a script that generates 100k test cards, and verify the targets with it.

## UI: follow Apple HIG (macOS) rigorously
- Clarity, deference, depth: content first, quiet chrome. No gradients, glows, emoji, or decorative shadows (shadows only on sheets and popovers).
- It's a web app, but it should look and feel like a native macOS app, not a website. No page-style headers or footers.
- Layout: sidebar plus content split view, a toolbar, sheets for editors and import, alerts for destructive actions (Cancel is the default button; never auto-focus the destructive one).
- Use the macOS type scale, Apple system colors (light and dark), a 4-pt spacing grid, and controls at least 28 pt (study answer buttons 44 pt).
- System font stack with Inter bundled as the Linux fallback. Use Lucide icons (SF Symbols can't ship on Linux).
- Define all colors and sizes in one tokens file.
- Support dark mode, reduced motion and increased contrast. Visible focus rings, full keyboard navigation, an empty state on every list.
- Write the concrete tokens and screens in `docs/UI.md` before any UI work, and do a HIG audit at the end.

## Stack
Vite + Svelte 5 (runes) + TypeScript; SQLite WASM in a worker; no backend, no server. No UI or CSS framework. It ships as a static build and works offline as a PWA. Hash routing, no SvelteKit. Chrome/Chromium is the primary target; it must also work in Firefox. Use Vitest for logic tests. Keyboard shortcuts use Ctrl on Linux/Windows and ⌘ on macOS, and must never clash with browser shortcuts.
