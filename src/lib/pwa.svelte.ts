/** Service worker registration, update prompt and storage-persistence notice. */

const NOTICE_KEY = 'leitner.persistNoticeShown';

export const pwa: { updateReady: boolean; persistNotice: boolean } = $state({
  updateReady: false,
  persistNotice: false,
});

let waiting: ServiceWorker | null = null;

function track(reg: ServiceWorkerRegistration): void {
  const markWaiting = (w: ServiceWorker) => {
    waiting = w;
    pwa.updateReady = true;
  };
  // Only an update counts: the very first install has no controller yet.
  if (reg.waiting && navigator.serviceWorker.controller) markWaiting(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) markWaiting(w);
    });
  });
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      track(reg);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

/** Switches to the waiting worker, then reloads once it controls the page. */
export function applyUpdate(): void {
  if (!waiting) return location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Asks for persistent storage; if refused, shows a one-time notice. */
export async function requestPersistence(): Promise<void> {
  const storage = navigator.storage;
  if (!storage?.persist) return;
  try {
    if (await storage.persisted()) return;
    if (await storage.persist()) return;
  } catch {
    return;
  }
  if (!readFlag()) pwa.persistNotice = true;
}

export function dismissPersistNotice(): void {
  pwa.persistNotice = false;
  try {
    localStorage.setItem(NOTICE_KEY, '1');
  } catch {
    /* private mode: the notice may show again next time */
  }
}
