function markError(span: HTMLElement, smiles: string, err: unknown): void {
  const w = document.createElement('span');
  w.className = 'render-warn';
  w.textContent = smiles;
  w.title = err instanceof Error ? err.message : String(err);
  span.replaceChildren(w);
}

export async function hydrateSmiles(root: HTMLElement): Promise<void> {
  try {
    const spans = Array.from(root.querySelectorAll<HTMLElement>('.smiles:not([data-done])'));
    if (spans.length === 0) return;
    const SD = (await import('smiles-drawer')).default;
    const theme =
      typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    for (const span of spans) {
      if (span.hasAttribute('data-done')) continue;
      span.setAttribute('data-done', '');
      const smiles = span.dataset.smiles ?? '';
      const svgEl = span.querySelector('svg.smiles-svg');
      try {
        if (!svgEl) throw new Error('missing svg element');
        SD.parse(
          smiles,
          (tree: unknown) => {
            try {
              new SD.SvgDrawer({ width: 240, height: 180 }).draw(tree, svgEl, theme);
            } catch (e) {
              markError(span, smiles, e);
            }
          },
          (err: unknown) => markError(span, smiles, err),
        );
      } catch (e) {
        markError(span, smiles, e);
      }
    }
  } catch {
    // never throw
  }
}
