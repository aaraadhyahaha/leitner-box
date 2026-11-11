const MAX_TERMS = 8;
const WORD = /[\p{L}\p{N}]/u;

/** Build an FTS5 MATCH expression: each term quoted and prefix-matched, ANDed. Null when no usable terms. */
export function ftsQuery(text: string): string | null {
  const terms = text
    .normalize('NFC')
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => WORD.test(t))
    .slice(0, MAX_TERMS);
  return terms.length === 0 ? null : terms.map((t) => `"${t}"*`).join(' ');
}
