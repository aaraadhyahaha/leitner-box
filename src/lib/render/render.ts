import katex from 'katex';
import 'katex/contrib/mhchem';
import { tokenize, type Token } from './tokenize';

const CACHE_MAX = 500;
const cache = new Map<string, string>();

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function warn(message: string, raw: string): string {
  return `<span class="render-warn" title="${escapeHtml(message)}">${escapeHtml(raw)}</span>`;
}

function renderToken(t: Token): string {
  switch (t.type) {
    case 'text':
      return escapeHtml(t.value).replace(/\n/g, '<br>');
    case 'math':
      try {
        return katex.renderToString(t.tex, {
          displayMode: t.display,
          throwOnError: true,
          strict: 'ignore',
          trust: false,
        });
      } catch (e) {
        return warn(e instanceof Error ? e.message : String(e), t.raw);
      }
    case 'smiles': {
      const label = escapeHtml(t.caption ?? t.smiles);
      const caption =
        t.caption !== null ? `<span class="smiles-caption">${escapeHtml(t.caption)}</span>` : '';
      return (
        `<span class="smiles" data-smiles="${escapeHtml(t.smiles)}">` +
        `<svg class="smiles-svg" width="240" height="180" role="img" aria-label="${label}"></svg>` +
        `${caption}</span>`
      );
    }
  }
}

export function renderToHtml(src: string): string {
  const hit = cache.get(src);
  if (hit !== undefined) {
    cache.delete(src);
    cache.set(src, hit);
    return hit;
  }
  let html: string;
  try {
    html = tokenize(src).map(renderToken).join('');
  } catch (e) {
    html = warn(e instanceof Error ? e.message : String(e), src);
  }
  cache.set(src, html);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return html;
}
