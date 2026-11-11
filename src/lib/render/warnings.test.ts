import { describe, expect, it } from 'vitest';
import { mathWarnings } from './warnings';

describe('mathWarnings', () => {
  it('returns nothing for a clean string', () => {
    expect(mathWarnings('plain $x^2$ and $$\\frac{1}{2}$$ and \\ce{H2O}')).toEqual([]);
  });

  it('reports bad LaTeX with its raw source', () => {
    const w = mathWarnings('x $\\frac{1$ y');
    expect(w).toHaveLength(1);
    expect(w[0].raw).toBe('$\\frac{1$');
    expect(w[0].message).toBeTruthy();
  });

  it('reports a bad \\ce', () => {
    const w = mathWarnings('\\ce{\\bond{xyz}}');
    expect(w).toHaveLength(1);
    expect(w[0].raw).toBe('\\ce{\\bond{xyz}}');
    expect(w[0].message).toContain('mhchem');
  });

  it('reports two errors in one string', () => {
    const w = mathWarnings('$\\frac{1$ ok $x$ then $\\undefinedmacro$');
    expect(w.map((x) => x.raw)).toEqual(['$\\frac{1$', '$\\undefinedmacro$']);
  });
});
