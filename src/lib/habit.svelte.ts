import { call } from './db/client';
import type { HabitSummary } from './db/types';
import { refreshDecks } from './decks.svelte';
import { syncReminders } from './reminders/reminders.svelte';

export const habitStore: { summary: HabitSummary | null; error: string | null } = $state({
  summary: null,
  error: null,
});

let seq = 0;
let latest: Promise<void> = Promise.resolve();

/** Resolves once the most recently started refresh has finished. */
export async function habitSettled(): Promise<void> {
  let p: Promise<void>;
  do {
    p = latest;
    await p;
  } while (p !== latest);
}

export function refreshHabit(): Promise<void> {
  const run = load(++seq);
  latest = run;
  return run;
}

async function load(n: number): Promise<void> {
  try {
    const s = await call('habit.summary', null);
    if (n !== seq) return;
    habitStore.summary = s;
    habitStore.error = null;
    await syncReminders(s);
  } catch (e) {
    if (n === seq) habitStore.error = e instanceof Error ? e.message : String(e);
  }
}

let started = false;
let midnight: ReturnType<typeof setTimeout> | undefined;

function armMidnight(): void {
  if (midnight !== undefined) clearTimeout(midnight);
  const next = new Date();
  next.setHours(24, 0, 1, 0);
  midnight = setTimeout(() => {
    void refreshDecks();
    armMidnight();
  }, next.getTime() - Date.now());
}

/** Call once on mount. The first load comes from App's refreshDecks, which refreshes habit too. */
export function startHabit(): void {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refreshDecks();
      armMidnight(); // timers drift or pause while the machine sleeps
    }
  });
  armMidnight();
}
