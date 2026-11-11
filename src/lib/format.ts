const nf = new Intl.NumberFormat();

/** A count with the locale's thousands separators: 12345 → "12,345". */
export function fmt(n: number): string {
  return nf.format(n);
}

/** "1 card", "12,345 cards". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${fmt(n)} ${n === 1 ? singular : plural}`;
}
