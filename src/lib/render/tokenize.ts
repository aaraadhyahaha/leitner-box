export type Token =
  | { type: 'text'; value: string }
  | { type: 'math'; tex: string; display: boolean; raw: string }
  | { type: 'smiles'; smiles: string; caption: string | null; raw: string };

/** Index of the closing `$` (or `$$` when display) starting at `from`, or -1. */
function findMathClose(src: string, from: number, display: boolean): number {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2; // skip escaped char (includes `\$`)
      continue;
    }
    if (!display && c === '\n' && src[i + 1] === '\n') return -1;
    if (c === '$') {
      if (display) {
        if (src[i + 1] === '$') return i;
      } else {
        return i;
      }
    }
    i++;
  }
  return -1;
}

/** Index just past the balanced `}` matching the `{` at `open`, or -1. */
function matchBraces(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let text = '';
  const flush = () => {
    if (text) {
      out.push({ type: 'text', value: text });
      text = '';
    }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === '\\' && src[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }

    if (c === '$') {
      if (src[i + 1] === '$') {
        const close = findMathClose(src, i + 2, true);
        if (close !== -1) {
          flush();
          out.push({
            type: 'math',
            tex: src.slice(i + 2, close),
            display: true,
            raw: src.slice(i, close + 2),
          });
          i = close + 2;
          continue;
        }
      } else {
        const close = findMathClose(src, i + 1, false);
        if (close > i + 1) {
          flush();
          out.push({
            type: 'math',
            tex: src.slice(i + 1, close),
            display: false,
            raw: src.slice(i, close + 1),
          });
          i = close + 1;
          continue;
        }
      }
      text += '$';
      i++;
      continue;
    }

    if (c === '{' && src.startsWith('{{smiles:', i)) {
      const end = src.indexOf('}}', i + 9);
      if (end !== -1) {
        const body = src.slice(i + 9, end);
        const bar = body.indexOf('|');
        const smiles = (bar === -1 ? body : body.slice(0, bar)).trim();
        const capRaw = bar === -1 ? '' : body.slice(bar + 1).trim();
        if (smiles) {
          flush();
          out.push({
            type: 'smiles',
            smiles,
            caption: capRaw === '' ? null : capRaw,
            raw: src.slice(i, end + 2),
          });
          i = end + 2;
          continue;
        }
      }
    }

    if (c === '\\' && (src.startsWith('\\ce{', i) || src.startsWith('\\pu{', i))) {
      const end = matchBraces(src, i + 3);
      if (end !== -1) {
        flush();
        const raw = src.slice(i, end);
        out.push({ type: 'math', tex: raw, display: false, raw });
        i = end;
        continue;
      }
    }

    text += c;
    i++;
  }
  flush();
  return out;
}
