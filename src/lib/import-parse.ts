// Import parser: validates JSONL / JSON-array card files. Runs in the worker.

export interface ParsedCard {
  deck: string | null;
  front: string;
  back: string;
  tags: string[];
}
export type Parsed = { ok: true; card: ParsedCard } | { ok: false; message: string };
export type ParsedLine = Parsed & { line: number };

const BOM = '﻿';

function fail(message: string): Parsed {
  return { ok: false, message };
}

function normTags(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const tag = t.trim().replace(/\s+/g, '-');
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export function validateCard(value: unknown): Parsed {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('Not an object');
  }
  const o = value as Record<string, unknown>;

  const front = typeof o.front === 'string' ? o.front.trim() : '';
  if (front === '') return fail('Missing front');
  const back = typeof o.back === 'string' ? o.back.trim() : '';
  if (back === '') return fail('Missing back');

  let deck: string | null = null;
  if (o.deck !== undefined && o.deck !== null) {
    if (typeof o.deck !== 'string') return fail('deck must be a string');
    const d = o.deck.trim();
    deck = d === '' ? null : d;
  }

  let tags: string[] = [];
  if (o.tags !== undefined && o.tags !== null) {
    if (typeof o.tags === 'string') {
      tags = normTags(o.tags.split(/[\s,]+/));
    } else if (Array.isArray(o.tags) && o.tags.every((t) => typeof t === 'string')) {
      tags = normTags(o.tags as string[]);
    } else {
      return fail('tags must be an array of strings');
    }
  }

  return { ok: true, card: { deck, front, back, tags } };
}

export function parseLine(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('Invalid JSON');
  }
  return validateCard(value);
}

function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function cardHash(front: string, back: string): string {
  const s = front.normalize('NFC').trim() + '\u0000' + back.normalize('NFC').trim();
  const hex = (n: number) => n.toString(16).padStart(14, '0');
  return hex(cyrb53(s, 0)) + hex(cyrb53(s, 1));
}

function stripBom(s: string): string {
  return s.startsWith(BOM) ? s.slice(1) : s;
}

export async function* readCards(file: Blob): AsyncGenerator<ParsedLine> {
  const head = stripBom(await file.slice(0, 64).text()).trimStart();
  if (head.startsWith('[')) {
    let arr: unknown;
    try {
      arr = JSON.parse(stripBom(await file.text()));
    } catch {
      arr = undefined;
    }
    if (!Array.isArray(arr)) {
      yield { line: 1, ok: false, message: 'Invalid JSON array' };
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      yield { ...validateCard(arr[i]), line: i + 1 };
    }
    return;
  }

  let lineNo = 0;
  const emit = (raw: string): ParsedLine | null => {
    lineNo++;
    let text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (lineNo === 1) text = stripBom(text);
    if (text.trim() === '') return null;
    return { ...parseLine(text), line: lineNo };
  };

  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let carry = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += value;
      let start = 0;
      let nl: number;
      while ((nl = carry.indexOf('\n', start)) !== -1) {
        const r = emit(carry.slice(start, nl));
        start = nl + 1;
        if (r) yield r;
      }
      carry = carry.slice(start);
    }
    if (carry !== '') {
      const r = emit(carry);
      if (r) yield r;
    }
  } finally {
    reader.releaseLock();
  }
}
