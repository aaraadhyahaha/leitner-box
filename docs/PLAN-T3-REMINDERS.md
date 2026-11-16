# Tier 3: Daily review reminders and habit

## Context
You want a daily reminder for the decks that are due today, and you want the daily review to feel like a habit, not a chore. The app is local-first and has no server, so it can't push to the browser at an exact time. To work around that, reminders use three channels that complement each other:
1. **Calendar event (.ics)**: one recurring daily event at your chosen time that links to `#/today`. It works on every OS and browser, even when the app is closed.
2. **Browser notifications** (best effort, with live due counts): a timer while the app is open, plus Periodic Background Sync when the app is installed in Chrome. The service worker can't open SQLite, so the page writes a small **due forecast** to IndexedDB that the SW reads. The forecast is exact for up to 30 days, because due counts only change when you study or import, and both of those rewrite it.
3. **In-app Today screen**: one calm place that says what's due, how long it will take, and when you're done.

Habit design (professional and quiet, HIG-compliant: no emoji, glows or confetti):
- **Small and concrete**: "42 cards · about 6 min". The estimate comes from your real pace.
- **Low barrier**: "Just 10" quick start when the backlog is over 30.
- **Closure**: finishing a deck leads straight to "Next: Physics · 12 due". Finishing everything shows "All caught up. Tomorrow: 18 cards."
- **Forgiving momentum**: the day streak counts days you cleared your reminded decks. Days with nothing due don't break it, and one missed day in any 7 is forgiven. A quiet 12-week rhythm grid shows the pattern.
- Each deck has a **"Remind Me Daily"** toggle (on by default). Reminders and the streak only count reminded decks.

The CLAUDE.md "Out of scope" list no longer excludes stats dashboards, so the streak and grid are allowed.

Execution follows CLAUDE.md. The orchestrator writes cards into `docs/PLAN.md §4` and the UI spec into `docs/UI.md §7.13`. Opus executors run the cards. The orchestrator runs each check, commits per card, ticks `docs/STATUS.md` and updates the CLAUDE.md file map.

## Contracts (fixed up front)

**Schema v2** (`src/lib/db/schema.ts` exports `SCHEMA_V2`; `migrate` runs V1 then V2 for version 0, and V2 for version 1, each in a transaction):
```sql
ALTER TABLE decks ADD COLUMN remind INTEGER NOT NULL DEFAULT 1;
CREATE TABLE days(
  day INTEGER PRIMARY KEY,          -- dayNumber
  reviewed INTEGER NOT NULL DEFAULT 0,
  cleared INTEGER NOT NULL DEFAULT 0, -- 1 once no reminded-deck card is due that day
  planned INTEGER);                 -- forecast due count for reminded decks, written ahead
CREATE INDEX reviews_time ON reviews(reviewed_at);
PRAGMA user_version = 2;
```
The migration backfills `days(day, reviewed, cleared=1)` from `reviews`, grouped by `dayNumber(reviewed_at, current tz offset)`.

**types.ts additions**
```ts
DeckSummary { …; remind: boolean }
export interface DayRecord { day: number; reviewed: number; cleared: boolean; planned: number | null }
export interface HabitSummary {
  today: number;
  days: DayRecord[];                         // today-83 .. today, rows that exist only
  secondsPerCard: number;                    // median gap < 120 s over the last 300 reviews, clamp 3..60, default 8
  forecast: { deckId: number; name: string; byDay: number[] }[]; // reminded decks; byDay[i] = due on today+i, i = 0..30
}
Api += {
  'deck.setRemind': { req: { id: number; remind: boolean }; res: null };
  'habit.summary':  { req: null; res: HabitSummary };
}
```
Worker semantics:
- `study.answer` upserts `days.reviewed += 1` and sets `cleared` from the count of due cards left in reminded decks. `study.undo` does the reverse and recomputes `cleared`.
- `habit.summary` sets today's `cleared` when nothing is due and writes `planned` for today+1 … today+30. Target: under 20 ms at 100k cards.

**`src/lib/habit.ts`** (pure, tested)
- `computeStreak(days, today) → { length: number; forgiven: number[] }`. Walk back from today, or from yesterday if today isn't kept yet. A day is **kept** if `cleared`. It is **rest** if `planned === 0` and it isn't cleared, and rest days count toward the streak. A **missed** day is forgiven if no other day was forgiven in the previous 6 days of the run; otherwise the streak stops there.
- `rhythmCells(days, today) → { day; status: 'kept'|'rest'|'forgiven'|'missed'|'future'|'none'; level: 0..4 }[]` gives 84 cells, Monday-aligned columns.
- `estimateMinutes(due, secondsPerCard)` returns `max(1, ceil(due*spc/60))`.

**`src/lib/reminders/`**
- `core.ts`:
  - `ReminderPrefs { time: string /*"HH:MM"*/; notify: boolean }`, default `{ time: '19:00', notify: false }`.
  - `Snapshot { day; time; notify; streak; decks: { id; name; byDay: number[] }[]; notifiedDay: number | null }`.
  - `dueOn(snapshot, today)`.
  - `shouldNotify(snapshot, nowMs, tzOffsetMin)`: true when notify is on, at least one card is due today, local time ≥ `time`, and `notifiedDay !== today`.
  - `notificationText(snapshot, today) → { title: 'Leitner', body }`, for example "Organic Chemistry 18 · Physics 7 · about 4 min. Keep your 12-day streak going."
- `store.ts`: IndexedDB `leitner-reminders`, store `kv`, keys `prefs` and `snapshot`. `getPrefs`, `setPrefs`, `writeSnapshot` and `markNotified(day)` are all wrapped in try/catch.
- `ics.ts`: `buildIcs({ time, url, deckNames }) → string`. One VEVENT with a stable `UID:leitner-daily@leitner`, floating local `DTSTART` tomorrow at `time`, `RRULE:FREQ=DAILY`, 15-minute duration, `URL` and a description with the link, and a `VALARM` (DISPLAY, trigger 0). Lines use CRLF and are folded at 75 octets.
- `reminders.svelte.ts` (runtime):
  - `reminders` state: `{ prefs, permission, support: { notify, periodic, badge } }`.
  - `syncReminders(summary)`: writes the snapshot, calls `setAppBadge(dueToday)` or clears it, and re-arms one `setTimeout` to today's reminder time, which calls `reg.showNotification` when `shouldNotify` is true.
  - `enableNotifications()`: on a user gesture, asks for permission, then registers periodic sync `'leitner-daily'` with `minInterval` 12 h if it's supported.
  - `downloadIcs()`.

**Service worker** (`public/sw-template.js`): a hand-ported copy of `dueOn`, `shouldNotify` and `notificationText`, marked "keep in sync with src/lib/reminders/core.ts", plus a small IndexedDB read.
- `periodicsync` with tag `'leitner-daily'`: show the notification (tag `'leitner-daily'`, action `start` "Start Review") and mark it notified.
- `notificationclick`: focus an existing client and navigate it to `#/today`, or `openWindow(scope + '#/today')`.

**Router**: adds `{ name: 'today' }` at `#/today`; home redirects to today once decks exist. Study gets an optional limit: `{ name: 'study'; deckId; limit?: number }` ↔ `#/study/3?n=10`.

## Cards (written into docs/PLAN.md §4)

- **T3.A Spec** (orchestrator): writes UI.md §7.13 and PLAN §4.
  - Today screen: toolbar "Today" with the long date and a bell button "Reminders…". Hero: count in `--text-large-title`, then "about N min · across K decks", a `.btn-primary` "Start Review" (Enter), and "Just 10" (`T`) when more than 30 cards are due. Below that, a streak line with a `CalendarCheck` icon, the rhythm grid (accent at 4 opacity levels as tokens, today outlined, `role="img"` with a label and a `title` per cell), then the reminded-deck list (name, "N due", Study). Empty or caught-up state: "All Caught Up" / "Tomorrow: 18 cards".
  - Sidebar: a "Today" row above Decks with a due badge.
  - Reminders sheet: time field, a "Show notifications" checkbox with an honest support line, per-deck checkboxes, and "Add to Calendar…".
  - DeckView: a `Bell` / `BellOff` toggle "Remind Me Daily" (`aria-pressed`).
  - Study end: "Next: {deck} · N due" as the primary button, or "That's today done · 13-day streak".
- **Wave H (parallel, disjoint files)**
  - **T3.1 DB**: `schema.ts`, `types.ts`, `ops.ts` (migrate, listDecks remind, answer hook), new `habit-ops.ts` and `habit-ops.test.ts`, `card-ops.ts` (undo hook, setRemind) and `worker.ts`. Check: `npx vitest run src/lib/db && npm run check`.
  - **T3.2 Habit logic**: `src/lib/habit.ts` and `habit.test.ts`. Tests cover rest days, forgiveness inside and outside the 7-day window, today not yet kept, and empty history. Check: `npx vitest run src/lib/habit.test.ts`.
  - **T3.3 Reminders core**: `src/lib/reminders/{core,store,ics}.ts`, with tests for `core` and `ics` (folding, CRLF, RRULE), and `public/sw-template.js`. Check: `npx vitest run src/lib/reminders`.
- **Wave I**
  - **T3.4 Today and reminders UI**: `router.svelte.ts` (and its test), `App.svelte`, `Sidebar.svelte`, new `TodayView.svelte`, `RemindersSheet.svelte`, `RhythmGrid.svelte`, `src/lib/reminders/reminders.svelte.ts`, `src/lib/habit.svelte.ts` (`habitStore`, `refreshHabit()` calling `habit.summary` and then `syncReminders`, run on start, on visibility and after `refreshDecks`), and `tokens.css` (rhythm levels). Check: `npm run check && npx vitest run src/lib/router.test.ts`.
- **Wave J**
  - **T3.5 Study and deck hooks**: `StudyView.svelte` (the `limit` prop caps the queue; the end screen shows next deck or done-for-today, and calls `refreshHabit`), `DeckView.svelte` (Remind toggle via `deck.setRemind`, then `refreshDecks`), and the `App.svelte` pass-through of `limit`. Check: `npm run check`.
- **T3.6 Verify and audit** (orchestrator):
  - Run `npm run test && npm run check && npm run build`.
  - Run a Chrome check with throwaway playwright-core: grant notification permission, set the reminder time to one minute ahead, and confirm the notification fires. Confirm `notificationclick` opens `#/today`. Import the `.ics` into a calendar parser, or validate it by eye.
  - In Firefox, confirm the calendar and in-app paths work and that the sheet says background notifications are unavailable.
  - Perf: `habit.summary` under 20 ms and `study.answer` still fast with 100k cards (`?perf`).
  - Run the UI.md §8 HIG audit on the new screens, and log the decisions in STATUS.

## Verification
- Unit: `npm run test`. This covers streak and forgiveness, `shouldNotify` timing and time zones, ICS format, v1→v2 migration with backfill, the days upsert on answer and undo, and the forecast against brute force.
- Types: `npm run check`. Build: `npm run build`, which produces `dist/sw.js` with the reminder handlers.
- Browser (Chrome 157): study a deck to zero, then check that Today shows "All Caught Up" and the streak goes up. A notification fires at the set time while the app is open. Clicking it routes to Today. The downloaded `.ics` adds a daily event.
