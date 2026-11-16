// Ported by hand into public/sw-template.js. Keep the two in sync.
import { dayNumber } from '../leitner';

export interface ReminderPrefs { time: string; notify: boolean } // "HH:MM"
export const DEFAULT_PREFS: ReminderPrefs = { time: '19:00', notify: false };
export interface SnapshotDeck { id: number; name: string; byDay: number[] }
export interface Snapshot {
  day: number; time: string; notify: boolean; streak: number; secondsPerCard: number;
  decks: SnapshotDeck[]; notifiedDay: number | null;
}

const MS_PER_DAY = 86_400_000;
const DEFAULT_MINUTES = 19 * 60;

/** Due per deck on `today`, from a snapshot written on `s.day`. Cards due on skipped days pile up. */
export function dueOn(s: Snapshot, today: number): { id: number; name: string; due: number }[] {
  const k = Math.min(30, Math.max(0, today - s.day));
  const out: { id: number; name: string; due: number }[] = [];
  for (const d of s.decks) {
    let due = 0;
    for (let i = 0; i <= k && i < d.byDay.length; i++) due += d.byDay[i] ?? 0;
    if (due > 0) out.push({ id: d.id, name: d.name, due });
  }
  return out.sort((a, b) => b.due - a.due || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function minutesOfDay(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return DEFAULT_MINUTES;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return DEFAULT_MINUTES;
  return h * 60 + min;
}

export function localMinute(nowMs: number, tzOffsetMin: number): number {
  const t = nowMs - tzOffsetMin * 60_000;
  return Math.floor((((t % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 60_000);
}

export function shouldNotify(s: Snapshot, nowMs: number, tzOffsetMin: number): boolean {
  if (!s.notify) return false;
  const today = dayNumber(nowMs, tzOffsetMin);
  if (s.notifiedDay === today) return false;
  if (localMinute(nowMs, tzOffsetMin) < minutesOfDay(s.time)) return false;
  return dueOn(s, today).length > 0;
}

export function notificationText(s: Snapshot, today: number): { title: string; body: string } {
  const due = dueOn(s, today);
  const total = due.reduce((n, d) => n + d.due, 0);
  const parts = due.slice(0, 3).map((d) => `${d.name} ${d.due.toLocaleString()}`);
  if (due.length > 3) parts.push(`${due.length - 3} more`);
  const minutes = Math.max(1, Math.ceil((total * s.secondsPerCard) / 60));
  const streak = s.streak >= 2 ? ` Keep your ${s.streak}-day streak going.` : '';
  return { title: 'Leitner', body: `${parts.join(' · ')} · about ${minutes} min.${streak}` };
}
