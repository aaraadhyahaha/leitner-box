import { describe, expect, it } from 'vitest';
import { buildIcs } from './ics';

const enc = new TextEncoder();
const now = new Date(2026, 10, 16, 9, 30, 0); // local 16 Nov 2026
const url = 'https://example.test/leitner-box/#/today';

const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const prop = (ics: string, name: string) => unfold(ics).split('\r\n').find((l) => l.startsWith(`${name}:`));

describe('buildIcs', () => {
  const ics = buildIcs({ time: '19:05', url, deckNames: ['Physics', 'Organic Chemistry'], now });

  it('uses CRLF everywhere and ends with CRLF', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('has the fixed structure', () => {
    const lines = unfold(ics).split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('UID:leitner-daily@leitner');
    expect(lines).toContain('RRULE:FREQ=DAILY');
    expect(lines).toContain('DURATION:PT15M');
    expect(lines).toContain('TRIGGER:PT0M');
    expect(lines).toContain(`URL:${url}`);
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('starts tomorrow at the reminder time, floating', () => {
    expect(prop(ics, 'DTSTART')).toBe('DTSTART:20261117T190500');
    expect(prop(ics, 'DTSTAMP')).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
  });

  it('rolls over month ends', () => {
    const x = buildIcs({ time: '07:00', url, deckNames: [], now: new Date(2026, 11, 31, 22, 0) });
    expect(prop(x, 'DTSTART')).toBe('DTSTART:20270101T070000');
  });

  it('escapes commas, semicolons and newlines', () => {
    const x = buildIcs({ time: '19:00', url, deckNames: ['A; B', 'C'], now });
    expect(prop(x, 'DESCRIPTION')).toBe(`DESCRIPTION:Review your due cards: A\; B\\, C.\\n${url}`);
    expect(prop(buildIcs({ time: '19:00', url, deckNames: [], now }), 'DESCRIPTION'))
      .toBe(`DESCRIPTION:Review your due cards.\\n${url}`);
  });

  it('folds long lines at 75 octets without splitting code points', () => {
    const names = Array.from({ length: 12 }, (_, i) => `Химия органическая ${i} 化学 🧪`);
    const x = buildIcs({ time: '19:00', url, deckNames: names, now });
    const raw = x.split('\r\n');
    expect(raw.some((l) => l.startsWith(' '))).toBe(true);
    for (const l of raw) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    expect(x).not.toContain('�');
    const want = `DESCRIPTION:Review your due cards: ${names.join('\\, ')}.\\n${url}`;
    expect(prop(x, 'DESCRIPTION')).toBe(want);
  });
});
