let sdPromise: Promise<any> | null = null;

/** Lazily loads smiles-drawer once; this file is the only one that imports it. */
function loadSD(): Promise<any> {
  if (!sdPromise) {
    sdPromise = import('smiles-drawer').then((m) => m.default);
    sdPromise.catch(() => {
      sdPromise = null;
    });
  }
  return sdPromise;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String(err.message);
  return String(err);
}

/** Parses a SMILES string; resolves to an error message, or null when it parses. Never rejects. */
export async function checkSmiles(smiles: string): Promise<string | null> {
  try {
    const SD = await loadSD();
    return await new Promise<string | null>((resolve) => {
      try {
        SD.parse(
          smiles,
          () => resolve(null),
          (e: unknown) => resolve(errMessage(e) || 'Invalid SMILES'),
        );
      } catch (e) {
        resolve(errMessage(e) || 'Invalid SMILES');
      }
    });
  } catch (e) {
    return errMessage(e) || 'Could not load SMILES parser';
  }
}

function markError(span: HTMLElement, smiles: string, err: unknown): void {
  const w = document.createElement('span');
  w.className = 'render-warn';
  w.textContent = smiles;
  w.title = errMessage(err);
  span.replaceChildren(w);
}

export async function hydrateSmiles(root: HTMLElement): Promise<void> {
  try {
    const spans = Array.from(root.querySelectorAll<HTMLElement>('.smiles:not([data-done])'));
    if (spans.length === 0) return;
    const SD = await loadSD();
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
