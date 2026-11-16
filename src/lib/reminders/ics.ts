// One recurring daily calendar event (RFC 5545).

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Fold at 75 octets: CRLF + one space, never splitting a code point. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let octets = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (octets + n > limit) {
      out.push(cur);
      cur = '';
      octets = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    octets += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function parseTime(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  const h = m ? Number(m[1]) : 19;
  const min = m ? Number(m[2]) : 0;
  return h <= 23 && min <= 59 ? [h, min] : [19, 0];
}

export function buildIcs(o: { time: string; url: string; deckNames: string[]; now: Date }): string {
  const n = o.now;
  const stamp = `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}T`
    + `${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}Z`;
  const t = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  const [h, m] = parseTime(o.time);
  const start = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}T${pad(h)}${pad(m)}00`;
  const names = o.deckNames.length ? `: ${o.deckNames.join(', ')}` : '';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Leitner//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:leitner-daily@leitner',
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    'DURATION:PT15M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:Leitner review',
    `DESCRIPTION:${escapeText(`Review your due cards${names}.\n${o.url}`)}`,
    `URL:${o.url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Leitner review',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
