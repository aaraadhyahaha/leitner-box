import { describe, expect, it } from 'vitest';
import { parseHash, toHash, type Route } from './router.svelte';

describe('router', () => {
  const routes: Route[] = [
    { name: 'home' },
    { name: 'deck', deckId: 12 },
    { name: 'study', deckId: 12 },
  ];

  it('round-trips all routes', () => {
    for (const r of routes) expect(parseHash(toHash(r))).toEqual(r);
  });

  it('formats hashes', () => {
    expect(toHash({ name: 'home' })).toBe('#/');
    expect(toHash({ name: 'deck', deckId: 12 })).toBe('#/deck/12');
    expect(toHash({ name: 'study', deckId: 3 })).toBe('#/study/3');
  });

  it('parses valid hashes', () => {
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/deck/12')).toEqual({ name: 'deck', deckId: 12 });
    expect(parseHash('#/study/12')).toEqual({ name: 'study', deckId: 12 });
  });

  it('treats bad input as home', () => {
    for (const h of ['', '#/deck/', '#/deck/abc', '#/deck/0', '#/deck/12x', '#/foo', '#/study/-1']) {
      expect(parseHash(h)).toEqual({ name: 'home' });
    }
  });
});
