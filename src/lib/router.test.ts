import { describe, expect, it } from 'vitest';
import { parseHash, toHash, type Route } from './router.svelte';

describe('router', () => {
  const routes: Route[] = [
    { name: 'home' },
    { name: 'imports' },
    { name: 'deck', deckId: 12 },
    { name: 'study', deckId: 12 },
    { name: 'today' },
    { name: 'study', deckId: 3, limit: 10 },
  ];

  it('round-trips all routes', () => {
    for (const r of routes) expect(parseHash(toHash(r))).toEqual(r);
  });

  it('formats hashes', () => {
    expect(toHash({ name: 'home' })).toBe('#/');
    expect(toHash({ name: 'imports' })).toBe('#/imports');
    expect(toHash({ name: 'deck', deckId: 12 })).toBe('#/deck/12');
    expect(toHash({ name: 'study', deckId: 3 })).toBe('#/study/3');
    expect(toHash({ name: 'today' })).toBe('#/today');
    expect(toHash({ name: 'study', deckId: 3, limit: 10 })).toBe('#/study/3?n=10');
    expect(toHash({ name: 'study', deckId: 3, limit: 0 })).toBe('#/study/3');
  });

  it('parses valid hashes', () => {
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/imports')).toEqual({ name: 'imports' });
    expect(parseHash('#/deck/12')).toEqual({ name: 'deck', deckId: 12 });
    expect(parseHash('#/study/12')).toEqual({ name: 'study', deckId: 12 });
  });

  it('treats bad input as home', () => {
    for (const h of ['', '#/deck/', '#/deck/abc', '#/deck/0', '#/deck/12x', '#/foo', '#/study/-1', '#/imports/', '#/imports/3']) {
      expect(parseHash(h)).toEqual({ name: 'home' });
    }
  });

  it('parses today and study limits', () => {
    expect(parseHash('#/today')).toEqual({ name: 'today' });
    expect(parseHash('#/study/3?n=10')).toEqual({ name: 'study', deckId: 3, limit: 10 });
    expect(parseHash('#/study/3?n=1000')).toEqual({ name: 'study', deckId: 3, limit: 1000 });
  });

  it('drops a bad limit', () => {
    for (const n of ['0', '1001', 'abc', '', '-1', '2.5', '10x']) {
      expect(parseHash(`#/study/3?n=${n}`)).toEqual({ name: 'study', deckId: 3 });
    }
    expect(parseHash('#/deck/3?n=10')).toEqual({ name: 'home' });
    expect(parseHash('#/today/')).toEqual({ name: 'home' });
  });
});
