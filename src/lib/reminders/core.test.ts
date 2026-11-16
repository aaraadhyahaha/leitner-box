import { describe, expect, it } from 'vitest';
import { dayNumber } from '../leitner';
import { dueOn, minutesOfDay, notificationText, shouldNotify, type Snapshot } from './core';

const DAY = 20000;
const byDay = (vals: Record<number, number>) => Array.from({ length: 31 }, (_, i) => vals[i] ?? 0);

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    day: DAY, time: '19:00', notify: true, streak: 0, secondsPerCard: 8, notifiedDay: null,
    decks: [
      { id: 1, name: 'Physics', byDay: byDay({ 0: 7, 1: 3, 30: 100 }) },
      { id: 2, name: 'Organic Chemistry', byDay: byDay({ 0: 18 }) },
      { id: 3, name: 'Empty', byDay: byDay({}) },
    ],
    ...over,
  };
}

/** Epoch ms for local wall-clock `day` at hh:mm in a zone with this getTimezoneOffset(). */
const at = (day: number, hh: number, mm: number, tz: number) => day * 86_400_000 + (hh * 60 + mm) * 60_000 + tz * 60_000;

describe('dueOn', () => {
  it('lists due decks, most due first', () => {
    expect(dueOn(snap(), DAY)).toEqual([
      { id: 2, name: 'Organic Chemistry', due: 18 },
      { id: 1, name: 'Physics', due: 7 },
    ]);
  });

  it('accumulates over skipped days and clamps at 30', () => {
    expect(dueOn(snap(), DAY + 1).find((d) => d.id === 1)?.due).toBe(10);
    expect(dueOn(snap(), DAY + 29).find((d) => d.id === 1)?.due).toBe(10);
    expect(dueOn(snap(), DAY + 30).find((d) => d.id === 1)?.due).toBe(110);
    expect(dueOn(snap(), DAY + 400).find((d) => d.id === 1)?.due).toBe(110);
    expect(dueOn(snap(), DAY - 5).find((d) => d.id === 1)?.due).toBe(7);
  });

  it('breaks ties by name', () => {
    const s = snap({ decks: [{ id: 1, name: 'B', byDay: byDay({ 0: 1 }) }, { id: 2, name: 'A', byDay: byDay({ 0: 1 }) }] });
    expect(dueOn(s, DAY).map((d) => d.name)).toEqual(['A', 'B']);
  });
});

describe('minutesOfDay', () => {
  it('parses and falls back', () => {
    expect(minutesOfDay('19:05')).toBe(1145);
    expect(minutesOfDay('7:30')).toBe(450);
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('24:00')).toBe(1140);
    expect(minutesOfDay('nope')).toBe(1140);
  });
});

describe('shouldNotify', () => {
  for (const tz of [0, -330, 300]) {
    it(`fires at the reminder time and once a day (tz ${tz})`, () => {
      expect(dayNumber(at(DAY, 19, 0, tz), tz)).toBe(DAY);
      expect(shouldNotify(snap(), at(DAY, 18, 59, tz), tz)).toBe(false);
      expect(shouldNotify(snap(), at(DAY, 19, 0, tz), tz)).toBe(true);
      expect(shouldNotify(snap(), at(DAY, 23, 59, tz), tz)).toBe(true);
      expect(shouldNotify(snap({ notifiedDay: DAY }), at(DAY, 20, 0, tz), tz)).toBe(false);
      expect(shouldNotify(snap({ notifiedDay: DAY - 1 }), at(DAY, 20, 0, tz), tz)).toBe(true);
    });

    it(`handles midnight (tz ${tz})`, () => {
      const s = snap({ time: '00:00', notifiedDay: DAY });
      expect(shouldNotify(s, at(DAY, 23, 59, tz), tz)).toBe(false);
      expect(shouldNotify(s, at(DAY + 1, 0, 0, tz), tz)).toBe(true);
      expect(shouldNotify(snap({ time: '23:59' }), at(DAY, 23, 58, tz), tz)).toBe(false);
      expect(shouldNotify(snap({ time: '23:59' }), at(DAY, 23, 59, tz), tz)).toBe(true);
    });
  }

  it('is false with notify off or nothing due', () => {
    expect(shouldNotify(snap({ notify: false }), at(DAY, 20, 0, 0), 0)).toBe(false);
    expect(shouldNotify(snap({ decks: [] }), at(DAY, 20, 0, 0), 0)).toBe(false);
  });
});

describe('notificationText', () => {
  it('one deck, short streak', () => {
    const s = snap({ decks: [{ id: 1, name: 'Physics', byDay: byDay({ 0: 7 }) }], streak: 1 });
    expect(notificationText(s, DAY)).toEqual({ title: 'Leitner', body: 'Physics 7 · about 1 min.' });
  });

  it('five decks, long streak', () => {
    const decks = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ id: i, name, byDay: byDay({ 0: 50 - i * 10 }) }));
    const { body } = notificationText(snap({ decks, streak: 12 }), DAY);
    // total 150 * 8 s = 20 min
    expect(body).toBe('A 50 · B 40 · C 30 · 2 more · about 20 min. Keep your 12-day streak going.');
  });

  it('formats large counts', () => {
    const s = snap({ decks: [{ id: 1, name: 'Big', byDay: byDay({ 0: 1234 }) }] });
    expect(notificationText(s, DAY).body).toContain(`Big ${(1234).toLocaleString()} ·`);
  });
});
