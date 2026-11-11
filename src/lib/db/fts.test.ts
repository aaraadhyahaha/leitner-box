import { describe, expect, it } from 'vitest';
import { ftsQuery } from './fts';

describe('ftsQuery', () => {
  it('quotes each term with a prefix star', () => {
    expect(ftsQuery('mito power')).toBe('"mito"* "power"*');
  });

  it('removes double quotes and keeps FTS operators as plain terms', () => {
    expect(ftsQuery('say "hi" OR x')).toBe('"say"* "hi"* "OR"* "x"*');
    expect(ftsQuery('a"b')).toBe('"ab"*');
  });

  it('returns null for blank or punctuation-only input', () => {
    expect(ftsQuery('')).toBeNull();
    expect(ftsQuery('   ')).toBeNull();
    expect(ftsQuery('-- * "" ()')).toBeNull();
  });

  it('drops punctuation-only terms among real ones', () => {
    expect(ftsQuery('a - b')).toBe('"a"* "b"*');
  });

  it('keeps at most 8 terms', () => {
    expect(ftsQuery('1 2 3 4 5 6 7 8 9 10')).toBe('"1"* "2"* "3"* "4"* "5"* "6"* "7"* "8"*');
  });

  it('NFC-normalises', () => {
    expect(ftsQuery('é')).toBe('"é"*');
  });
});
