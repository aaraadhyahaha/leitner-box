import { describe, expect, it, vi } from 'vitest';
import katex from 'katex';
import { escapeHtml, renderToHtml } from './render';

describe('escapeHtml', () => {
  it('escapes & < > " \'', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('renderToHtml', () => {
  it('escapes script tags and keeps newlines', () => {
    const html = renderToHtml('<script>alert(1)</script>\nnext');
    expect(html).not.toContain('<script>');
    expect(html).toBe('&lt;script&gt;alert(1)&lt;/script&gt;<br>next');
  });

  it('bad LaTeX gives a render warning without throwing', () => {
    let html = '';
    expect(() => {
      html = renderToHtml('x $\\frac{1$ y');
    }).not.toThrow();
    expect(html).toContain('class="render-warn"');
    expect(html).toContain('$\\frac{1$');
  });

  it('renders bare \\ce via mhchem', () => {
    const html = renderToHtml('\\ce{H2O}');
    expect(html).toContain('katex');
    expect(html).not.toContain('render-warn');
  });

  it('display math', () => {
    expect(renderToHtml('$$x$$')).toContain('katex-display');
  });

  it('smiles markup', () => {
    const html = renderToHtml('{{smiles:C<O|"eth"}}');
    expect(html).toContain('data-smiles="C&lt;O"');
    expect(html).toContain('class="smiles-svg"');
    expect(html).toContain('width="240" height="180"');
    expect(html).toContain('aria-label="&quot;eth&quot;"');
    expect(html).toContain('<span class="smiles-caption">&quot;eth&quot;</span>');
  });

  it('smiles without caption labels with the smiles', () => {
    const html = renderToHtml('{{smiles:CCO}}');
    expect(html).toContain('aria-label="CCO"');
    expect(html).not.toContain('smiles-caption');
  });

  it('caches results', () => {
    const spy = vi.spyOn(katex, 'renderToString');
    const src = '$y^{3}$ cache test';
    const a = renderToHtml(src);
    const b = renderToHtml(src);
    expect(b).toBe(a);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
