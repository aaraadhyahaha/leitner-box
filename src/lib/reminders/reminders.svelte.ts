/** Reminder runtime: prefs, permission, badge, in-app timer, calendar download. */
import type { HabitSummary } from '../db/types';
import { computeStreak } from '../habit';
import { dayNumber } from '../leitner';
import { DEFAULT_PREFS, minutesOfDay, notificationText, shouldNotify, type ReminderPrefs } from './core';
import { getPrefs, getSnapshot, markNotified, setPrefs, writeSnapshot } from './store';
import { buildIcs } from './ics';

export const PERIODIC_TAG = 'leitner-daily';
const PERIODIC_MIN_INTERVAL = 12 * 3600 * 1000;

const hasWindow = typeof window !== 'undefined';

function detectSupport(): { notify: boolean; periodic: boolean; badge: boolean } {
  if (!hasWindow) return { notify: false, periodic: false, badge: false };
  const sw = 'serviceWorker' in navigator;
  return {
    notify: 'Notification' in window && sw,
    periodic: sw && typeof ServiceWorkerRegistration !== 'undefined' && 'periodicSync' in ServiceWorkerRegistration.prototype,
    badge: 'setAppBadge' in navigator,
  };
}

export const reminders: {
  prefs: ReminderPrefs;
  permission: NotificationPermission | 'unsupported';
  support: { notify: boolean; periodic: boolean; badge: boolean };
} = $state({ prefs: { ...DEFAULT_PREFS }, permission: 'unsupported', support: detectSupport() });

/** Notifications are on only when the user asked for them and the browser still allows them. */
export function notifyActive(): boolean {
  return reminders.prefs.notify && reminders.permission === 'granted';
}

let lastSummary: HabitSummary | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function readPermission(): NotificationPermission | 'unsupported' {
  return reminders.support.notify ? Notification.permission : 'unsupported';
}

export async function loadReminders(): Promise<void> {
  reminders.support = detectSupport();
  reminders.permission = readPermission();
  reminders.prefs = await getPrefs();
  if (hasWindow && !listening && 'serviceWorker' in navigator) {
    listening = true;
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { type?: string; hash?: string } | null;
      if (data?.type === 'route' && typeof data.hash === 'string') location.hash = data.hash;
    });
  }
  if (lastSummary) await syncReminders(lastSummary);
}

export async function savePrefs(p: ReminderPrefs): Promise<void> {
  reminders.prefs = { time: p.time, notify: p.notify };
  await setPrefs({ time: p.time, notify: p.notify });
  if (lastSummary) await syncReminders(lastSummary);
}

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

function setBadge(n: number): void {
  const nav = navigator as BadgeNavigator;
  try {
    const p = n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.();
    void p?.catch(() => {});
  } catch {
    /* unsupported */
  }
}

/** Shows the daily notification through the service worker when it is due and not yet shown. */
async function fire(): Promise<void> {
  const s = await getSnapshot();
  const now = Date.now();
  const tz = new Date().getTimezoneOffset();
  if (!s || !shouldNotify(s, now, tz) || reminders.permission !== 'granted') return;
  const today = dayNumber(now, tz);
  try {
    const reg = await navigator.serviceWorker.ready;
    const { title, body } = notificationText(s, today);
    await reg.showNotification(title, {
      body,
      tag: PERIODIC_TAG,
      icon: 'icon.svg',
      actions: [{ action: 'start', title: 'Start Review' }],
    } as NotificationOptions);
    await markNotified(today);
  } catch {
    /* no service worker or notifications blocked */
  }
}

function arm(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (!notifyActive()) return;
  const now = new Date();
  const minutes = minutesOfDay(reminders.prefs.time);
  const at = new Date(now);
  at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  const delay = at.getTime() - now.getTime();
  if (delay <= 0) return; // never back-fill a missed time
  timer = setTimeout(() => {
    timer = undefined;
    void fire();
  }, delay);
}

export async function syncReminders(s: HabitSummary): Promise<void> {
  lastSummary = s;
  const decks = s.forecast.map((f) => ({ id: f.deckId, name: f.name, byDay: f.byDay }));
  if (hasWindow) setBadge(decks.reduce((n, d) => n + (d.byDay[0] ?? 0), 0));
  arm();
  await writeSnapshot({
    day: s.today,
    time: reminders.prefs.time,
    notify: notifyActive(),
    streak: computeStreak(s.days, s.today).length,
    secondsPerCard: s.secondsPerCard,
    decks,
  });
}

type PeriodicRegistration = ServiceWorkerRegistration & {
  periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void> };
};

/** Asks for permission (call from the click handler) and turns notifications on if granted. */
export async function enableNotifications(): Promise<boolean> {
  if (!reminders.support.notify) return false;
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    permission = Notification.permission;
  }
  reminders.permission = permission;
  if (permission !== 'granted') return false;
  if (reminders.support.periodic) {
    try {
      const reg = (await navigator.serviceWorker.ready) as PeriodicRegistration;
      await reg.periodicSync?.register(PERIODIC_TAG, { minInterval: PERIODIC_MIN_INTERVAL });
    } catch {
      /* not installed, or the browser declined: the in-app timer still works */
    }
  }
  await savePrefs({ ...reminders.prefs, notify: true });
  return true;
}

export function downloadIcs(deckNames: string[]): void {
  const text = buildIcs({
    time: reminders.prefs.time,
    url: location.origin + location.pathname + '#/today',
    deckNames,
    now: new Date(),
  });
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'leitner-reminder.ics';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
