import { describe, expect, it } from 'vitest';
import { count, fmt } from './format';

describe('format', () => {
  it('adds thousands separators', () => {
    expect(fmt(1234567)).toBe(new Intl.NumberFormat().format(1234567));
    expect(fmt(12)).toBe('12');
  });
  it('pluralises', () => {
    expect(count(1, 'card')).toBe('1 card');
    expect(count(0, 'card')).toBe('0 cards');
    expect(count(2, 'Box', 'Boxes')).toBe('2 Boxes');
  });
});
