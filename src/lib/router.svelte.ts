export type Route =
  | { name: 'home' }
  | { name: 'deck'; deckId: number }
  | { name: 'study'; deckId: number };

const ROUTE_RE = /^#\/(deck|study)\/(\d+)$/;

export function parseHash(hash: string): Route {
  const m = ROUTE_RE.exec(hash);
  if (!m) return { name: 'home' };
  const deckId = Number(m[2]);
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return { name: 'home' };
  return m[1] === 'deck' ? { name: 'deck', deckId } : { name: 'study', deckId };
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'deck':
      return `#/deck/${route.deckId}`;
    case 'study':
      return `#/study/${route.deckId}`;
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

export function go(route: Route): void {
  router.route = route;
  if (hasWindow) {
    const hash = toHash(route);
    if (window.location.hash !== hash) window.location.hash = hash;
  }
}
