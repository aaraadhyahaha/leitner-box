import { describe, expect, it } from 'vitest';
import { cardHash, parseLine, readCards, validateCard, type ParsedLine } from './import-parse';

async function collect(blob: Blob): Promise<ParsedLine[]> {
  const out: ParsedLine[] = [];
  for await (const r of readCards(blob)) out.push(r);
  return out;
}

function msg(text: string): string | null {
  const r = parseLine(text);
  return r.ok ? null : r.message;
}

describe('validateCard / parseLine', () => {
  it('accepts a minimal card and trims', () => {
    expect(parseLine('{"front":" a ","back":" b ","extra":1}')).toEqual({
      ok: true,
      card: { deck: null, front: 'a', back: 'b', tags: [] },
    });
  });

  it('reports each error message', () => {
    expect(msg('{bad')).toBe('Invalid JSON');
    expect(msg('[1,2]')).toBe('Not an object');
    expect(msg('null')).toBe('Not an object');
    expect(msg('42')).toBe('Not an object');
    expect(msg('{"back":"b"}')).toBe('Missing front');
    expect(msg('{"front":"  ","back":"b"}')).toBe('Missing front');
    expect(msg('{"front":5,"back":"b"}')).toBe('Missing front');
    expect(msg('{"front":"a"}')).toBe('Missing back');
    expect(msg('{"front":"a","back":""}')).toBe('Missing back');
    expect(msg('{"front":"a","back":"b","deck":3}')).toBe('deck must be a string');
    expect(msg('{"front":"a","back":"b","tags":[1]}')).toBe('tags must be an array of strings');
    expect(msg('{"front":"a","back":"b","tags":{}}')).toBe('tags must be an array of strings');
  });

  it('checks in order object, front, back, deck, tags', () => {
    expect(msg('{"deck":1,"tags":1}')).toBe('Missing front');
    expect(msg('{"front":"a","deck":1,"tags":1}')).toBe('Missing back');
    expect(msg('{"front":"a","back":"b","deck":1,"tags":1}')).toBe('deck must be a string');
  });

  it('handles deck', () => {
    const d = (v: unknown) => {
      const r = validateCard({ front: 'a', back: 'b', deck: v });
      return r.ok ? r.card.deck : r.message;
    };
    expect(d(null)).toBeNull();
    expect(d('  ')).toBeNull();
    expect(d(' Chem ')).toBe('Chem');
  });

  it('normalises tags given as an array', () => {
    const r = validateCard({ front: 'a', back: 'b', tags: [' x ', 'two words', '', 'x', 'y'] });
    expect(r.ok && r.card.tags).toEqual(['x', 'two-words', 'y']);
  });

  it('splits tags given as a string', () => {
    const r = validateCard({ front: 'a', back: 'b', tags: ' a, b  c,,a ' });
    expect(r.ok && r.card.tags).toEqual(['a', 'b', 'c']);
  });
});

describe('cardHash', () => {
  it('is 28 lowercase hex chars', () => {
    expect(cardHash('a', 'b')).toMatch(/^[0-9a-f]{28}$/);
  });
  it('is equal under trimming', () => {
    expect(cardHash('  a ', 'b\n')).toBe(cardHash('a', 'b'));
  });
  it('differs for different text', () => {
    expect(cardHash('a', 'b')).not.toBe(cardHash('a', 'c'));
    expect(cardHash('ab', '')).not.toBe(cardHash('a', 'b'));
  });
  it('is equal for NFC and NFD', () => {
    const nfc = 'café';
    const nfd = 'café';
    expect(nfc).not.toBe(nfd);
    expect(cardHash(nfc, 'x')).toBe(cardHash(nfd, 'x'));
  });
});

describe('readCards JSONL', () => {
  it('handles CRLF, BOM, blank lines and line numbers', async () => {
    const text = '﻿{"front":"a","back":"b"}\r\n\r\n   \n{"front":"c","back":"d"}\r\nbad\n';
    const rs = await collect(new Blob([text]));
    expect(rs.map((r) => [r.line, r.ok])).toEqual([
      [1, true],
      [4, true],
      [5, false],
    ]);
    expect(rs[2]).toEqual({ line: 5, ok: false, message: 'Invalid JSON' });
  });

  it('flushes a final line without newline', async () => {
    const rs = await collect(new Blob(['{"front":"a","back":"b"}\n{"front":"c","back":"d"}']));
    expect(rs).toHaveLength(2);
    expect(rs[1]).toMatchObject({ line: 2, ok: true, card: { front: 'c' } });
  });

  it('joins a line split across chunks', async () => {
    const rs = await collect(new Blob(['{"front":"a","ba', 'ck":"b"}\n', '{"front":"x",', '"back":"y"}']));
    expect(rs).toEqual([
      { line: 1, ok: true, card: { deck: null, front: 'a', back: 'b', tags: [] } },
      { line: 2, ok: true, card: { deck: null, front: 'x', back: 'y', tags: [] } },
    ]);
  });

  it('decodes a multibyte char split across parts', async () => {
    const bytes = new TextEncoder().encode('{"front":"é€","back":"b"}\n');
    const cut = bytes.indexOf(0xe2) + 1; // inside the 3-byte euro sign
    const rs = await collect(new Blob([bytes.slice(0, cut), bytes.slice(cut)]));
    expect(rs).toEqual([{ line: 1, ok: true, card: { deck: null, front: 'é€', back: 'b', tags: [] } }]);
  });

  it('yields nothing for an empty file', async () => {
    expect(await collect(new Blob([]))).toEqual([]);
  });
});

describe('readCards JSON array', () => {
  it('reports element i as line i + 1', async () => {
    const text = '﻿  \n[{"front":"a","back":"b"}, 3, {"front":"c"}]';
    const rs = await collect(new Blob([text]));
    expect(rs).toEqual([
      { line: 1, ok: true, card: { deck: null, front: 'a', back: 'b', tags: [] } },
      { line: 2, ok: false, message: 'Not an object' },
      { line: 3, ok: false, message: 'Missing back' },
    ]);
  });

  it('reports an invalid array', async () => {
    expect(await collect(new Blob(['[{"front":"a",']))).toEqual([
      { line: 1, ok: false, message: 'Invalid JSON array' },
    ]);
  });
});
