export type Route =
  | { name: 'home' }
  | { name: 'today' }
  | { name: 'imports' }
  | { name: 'deck'; deckId: number }
  | { name: 'study'; deckId: number; limit?: number };

const ROUTE_RE = /^#\/(deck|study)\/(\d+)(?:\?n=([^&]*))?$/;
export const MAX_LIMIT = 1000;

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= 1 && n <= MAX_LIMIT ? n : undefined;
}

export function parseHash(hash: string): Route {
  if (hash === '#/imports') return { name: 'imports' };
  if (hash === '#/today') return { name: 'today' };
  const m = ROUTE_RE.exec(hash);
  if (!m) return { name: 'home' };
  const deckId = Number(m[2]);
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return { name: 'home' };
  if (m[1] === 'deck') return m[3] === undefined ? { name: 'deck', deckId } : { name: 'home' };
  const limit = parseLimit(m[3]);
  return limit === undefined ? { name: 'study', deckId } : { name: 'study', deckId, limit };
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'deck':
      return `#/deck/${route.deckId}`;
    case 'study': {
      const limit = parseLimit(route.limit === undefined ? undefined : String(route.limit));
      return limit === undefined ? `#/study/${route.deckId}` : `#/study/${route.deckId}?n=${limit}`;
    }
    case 'imports':
      return '#/imports';
    case 'today':
      return '#/today';
    default:
      return '#/';
  }
}

const hasWindow = typeof window !== 'undefined';

export const router: { route: Route } = $state({
  route: hasWindow ? parseHash(window.location.hash) : { name: 'home' },
});

if (hasWindow) {
  window.addEventListener('hashchange', () => {
    router.route = parseHash(window.location.hash);
  });
}

/** `replace` swaps the history entry instead of adding one (used for redirects). */
export function go(route: Route, opts: { replace?: boolean } = {}): void {
  router.route = route;
  if (hasWindow) {
    const hash = toHash(route);
    if (window.location.hash === hash) return;
    if (opts.replace) history.replaceState(history.state, '', hash);
    else window.location.hash = hash;
  }
}
