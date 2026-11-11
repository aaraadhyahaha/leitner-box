import { describe, expect, it } from 'vitest';
import { Selection } from './selection.svelte';
import type { CardQuery } from './db/types';

// Row i holds card id 100 + i.
const idAt = (i: number) => 100 + i;
const PLAIN = { toggle: false, range: false };
const TOGGLE = { toggle: true, range: false };
const RANGE = { toggle: false, range: true };
const query: CardQuery = { deckId: 1, search: 'acid', box: null };

function ids(sel: Selection): number[] {
  const s = sel.state;
  if (s.mode !== 'ids') throw new Error('not in ids mode');
  return [...s.ids].sort((a, b) => a - b);
}

function except(sel: Selection): number[] {
  const s = sel.state;
  if (s.mode !== 'all') throw new Error('not in all mode');
  return [...s.except].sort((a, b) => a - b);
}

describe('Selection', () => {
  it('starts empty', () => {
    const sel = new Selection();
    expect(ids(sel)).toEqual([]);
    expect(sel.anchor).toBeNull();
    expect(sel.count(10)).toBe(0);
    expect(sel.toRequest(query)).toBeNull();
  });

  it('plain click selects only that row and sets the anchor', () => {
    const sel = new Selection();
    sel.click(2, idAt, PLAIN);
    sel.click(5, idAt, PLAIN);
    expect(ids(sel)).toEqual([105]);
    expect(sel.anchor).toBe(5);
    expect(sel.has(105)).toBe(true);
    expect(sel.has(102)).toBe(false);
  });

  it('toggle flips a row and sets the anchor', () => {
    const sel = new Selection();
    sel.click(1, idAt, PLAIN);
    sel.click(3, idAt, TOGGLE);
    expect(ids(sel)).toEqual([101, 103]);
    expect(sel.anchor).toBe(3);
    sel.click(1, idAt, TOGGLE);
    expect(ids(sel)).toEqual([103]);
    expect(sel.anchor).toBe(1);
  });

  it('range selects downward from the anchor and keeps it', () => {
    const sel = new Selection();
    sel.click(2, idAt, PLAIN);
    sel.click(5, idAt, RANGE);
    expect(ids(sel)).toEqual([102, 103, 104, 105]);
    expect(sel.anchor).toBe(2);
  });

  it('range selects upward from the anchor and keeps it', () => {
    const sel = new Selection();
    sel.click(4, idAt, PLAIN);
    sel.click(1, idAt, RANGE);
    expect(ids(sel)).toEqual([101, 102, 103, 104]);
    expect(sel.anchor).toBe(4);
    // A second range from the same anchor replaces the first.
    sel.click(6, idAt, RANGE);
    expect(ids(sel)).toEqual([104, 105, 106]);
  });

  it('range with no anchor acts as a plain click', () => {
    const sel = new Selection();
    sel.click(3, idAt, RANGE);
    expect(ids(sel)).toEqual([103]);
    expect(sel.anchor).toBe(3);
  });

  it('selectAll switches to all mode', () => {
    const sel = new Selection();
    sel.click(1, idAt, PLAIN);
    sel.selectAll();
    expect(except(sel)).toEqual([]);
    expect(sel.has(999)).toBe(true);
    expect(sel.count(50)).toBe(50);
  });

  it('toggle in all mode adds and removes exceptions', () => {
    const sel = new Selection();
    sel.selectAll();
    sel.click(2, idAt, TOGGLE);
    expect(except(sel)).toEqual([102]);
    expect(sel.has(102)).toBe(false);
    expect(sel.anchor).toBe(2);
    expect(sel.count(10)).toBe(9);
    sel.click(2, idAt, TOGGLE);
    expect(except(sel)).toEqual([]);
  });

  it('range in all mode removes the range from the exceptions', () => {
    const sel = new Selection();
    sel.selectAll();
    sel.click(1, idAt, TOGGLE);
    sel.click(3, idAt, TOGGLE);
    sel.click(5, idAt, TOGGLE);
    expect(except(sel)).toEqual([101, 103, 105]);
    sel.click(2, idAt, RANGE); // anchor is 5 → rows 2..5
    expect(except(sel)).toEqual([101]);
    expect(sel.anchor).toBe(5);
  });

  it('plain click in all mode returns to ids mode with that row', () => {
    const sel = new Selection();
    sel.selectAll();
    sel.click(4, idAt, PLAIN);
    expect(ids(sel)).toEqual([104]);
    expect(sel.anchor).toBe(4);
  });

  it('replaces the state object instead of mutating it', () => {
    const sel = new Selection();
    const before = sel.state;
    sel.click(0, idAt, PLAIN);
    expect(sel.state).not.toBe(before);
    const mid = sel.state;
    sel.click(1, idAt, TOGGLE);
    expect(sel.state).not.toBe(mid);
    expect(mid.mode === 'ids' && [...mid.ids]).toEqual([100]);
  });

  it('clear empties the selection and the anchor', () => {
    const sel = new Selection();
    sel.selectAll();
    sel.click(1, idAt, TOGGLE);
    sel.clear();
    expect(ids(sel)).toEqual([]);
    expect(sel.anchor).toBeNull();
    expect(sel.toRequest(query)).toBeNull();
  });

  it('count never goes below zero', () => {
    const sel = new Selection();
    sel.selectAll();
    sel.click(0, idAt, TOGGLE);
    sel.click(1, idAt, TOGGLE);
    expect(sel.count(1)).toBe(0);
  });

  it('toRequest in ids mode lists the ids', () => {
    const sel = new Selection();
    sel.click(1, idAt, PLAIN);
    sel.click(3, idAt, TOGGLE);
    const req = sel.toRequest(query);
    expect(req).not.toBeNull();
    expect(req && 'ids' in req && [...req.ids].sort()).toEqual([101, 103]);
  });

  it('toRequest in all mode sends the query and exceptions', () => {
    const sel = new Selection();
    sel.selectAll();
    expect(sel.toRequest(query)).toEqual({ query, exceptIds: [] });
    sel.click(2, idAt, TOGGLE);
    expect(sel.toRequest(query)).toEqual({ query, exceptIds: [102] });
  });
});
