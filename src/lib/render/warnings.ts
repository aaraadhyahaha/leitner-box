import katex from 'katex';
import 'katex/contrib/mhchem';
import { tokenize } from './tokenize';
import { checkSmiles } from './smiles';
import type { ImportSample } from '../db/types';

export interface RenderWarning {
  line: number;
  side: 'front' | 'back';
  raw: string;
  message: string;
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  // mhchem throws [code, message] arrays.
  if (Array.isArray(e) && e.length > 0) return String(e[e.length - 1]);
  return String(e);
}

/** Renders every math token in `src` (same KaTeX options as render.ts) and collects the failures. */
export function mathWarnings(src: string): { raw: string; message: string }[] {
  const out: { raw: string; message: string }[] = [];
  let tokens;
  try {
    tokens = tokenize(src);
  } catch (e) {
    return [{ raw: src, message: messageOf(e) }];
  }
  for (const t of tokens) {
    if (t.type !== 'math') continue;
    try {
      katex.renderToString(t.tex, {
        displayMode: t.display,
        throwOnError: true,
        strict: 'ignore',
        trust: false,
      });
    } catch (e) {
      out.push({ raw: t.raw, message: messageOf(e) });
    }
  }
  return out;
}

/** Math and SMILES warnings for both sides of each sample card. Each distinct SMILES is parsed once. */
export async function sampleWarnings(sample: ImportSample[]): Promise<RenderWarning[]> {
  const out: RenderWarning[] = [];
  const smilesChecks = new Map<string, Promise<string | null>>();
  const pending: { line: number; side: 'front' | 'back'; raw: string; check: Promise<string | null> }[] = [];

  for (const card of sample) {
    for (const side of ['front', 'back'] as const) {
      const src = card[side];
      for (const w of mathWarnings(src)) out.push({ line: card.line, side, ...w });
      let tokens;
      try {
        tokens = tokenize(src);
      } catch {
        continue;
      }
      for (const t of tokens) {
        if (t.type !== 'smiles') continue;
        let check = smilesChecks.get(t.smiles);
        if (!check) {
          check = checkSmiles(t.smiles);
          smilesChecks.set(t.smiles, check);
        }
        pending.push({ line: card.line, side, raw: t.raw, check });
      }
    }
  }

  for (const p of pending) {
    const message = await p.check;
    if (message !== null) out.push({ line: p.line, side: p.side, raw: p.raw, message });
  }
  out.sort((a, b) => a.line - b.line || (a.side === b.side ? 0 : a.side === 'front' ? -1 : 1));
  return out;
}
