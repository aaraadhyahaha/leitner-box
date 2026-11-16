// Built into dist/sw.js by the swManifest() plugin in vite.config.ts.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `leitner-${VERSION}`;

self.addEventListener('install', (event) => {
  // No skipWaiting(): the page shows "Update available" and decides when to switch.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('leitner-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.jsonl')) return; // bench data: straight to the network
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        // Runtime cache, e.g. the lazily loaded SMILES chunk.
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') {
          const shell = await cache.match('./index.html', { ignoreVary: true });
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});

// Reminders: keep in sync with src/lib/reminders/core.ts
// (dayNumber is from src/lib/leitner.ts; the IndexedDB layout matches src/lib/reminders/store.ts.)
const MS_PER_DAY = 86400000;
const REMINDER_TAG = 'leitner-daily';

function dayNumber(epochMs, tzOffsetMin) {
  return Math.floor((epochMs - tzOffsetMin * 60000) / MS_PER_DAY);
}

function minutesOfDay(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return 1140;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return 1140;
  return h * 60 + min;
}

function localMinute(nowMs, tzOffsetMin) {
  const t = nowMs - tzOffsetMin * 60000;
  return Math.floor((((t % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 60000);
}

function dueOn(s, today) {
  const k = Math.min(30, Math.max(0, today - s.day));
  const out = [];
  for (const d of s.decks) {
    let due = 0;
    for (let i = 0; i <= k && i < d.byDay.length; i++) due += d.byDay[i] || 0;
    if (due > 0) out.push({ id: d.id, name: d.name, due });
  }
  return out.sort((a, b) => b.due - a.due || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function shouldNotify(s, nowMs, tzOffsetMin) {
  if (!s.notify) return false;
  const today = dayNumber(nowMs, tzOffsetMin);
  if (s.notifiedDay === today) return false;
  if (localMinute(nowMs, tzOffsetMin) < minutesOfDay(s.time)) return false;
  return dueOn(s, today).length > 0;
}

function notificationText(s, today) {
  const due = dueOn(s, today);
  const total = due.reduce((n, d) => n + d.due, 0);
  const parts = due.slice(0, 3).map((d) => `${d.name} ${d.due.toLocaleString()}`);
  if (due.length > 3) parts.push(`${due.length - 3} more`);
  const minutes = Math.max(1, Math.ceil((total * s.secondsPerCard) / 60));
  const streak = s.streak >= 2 ? ` Keep your ${s.streak}-day streak going.` : '';
  return { title: 'Leitner', body: `${parts.join(' · ')} · about ${minutes} min.${streak}` };
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('leitner-reminders', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key, value) {
  const db = await idbOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function remindIfDue() {
  try {
    const s = await idbGet('snapshot');
    if (!s) return;
    const now = Date.now();
    const tz = new Date().getTimezoneOffset();
    if (!shouldNotify(s, now, tz)) return;
    const today = dayNumber(now, tz);
    const { title, body } = notificationText(s, today);
    await self.registration.showNotification(title, {
      body,
      tag: REMINDER_TAG,
      icon: 'icon.svg',
      actions: [{ action: 'start', title: 'Start Review' }],
    });
    // Re-read so a snapshot the page wrote meanwhile isn't overwritten with stale counts.
    const latest = (await idbGet('snapshot')) || s;
    await idbPut('snapshot', { ...latest, notifiedDay: today });
  } catch {
    // Best effort: storage or notifications unavailable.
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === REMINDER_TAG) event.waitUntil(remindIfDue());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = self.registration.scope + '#/today';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = all[0];
      if (!client) {
        await self.clients.openWindow(url);
        return;
      }
      try {
        await client.focus();
      } catch {
        /* focus needs the click's activation; route anyway */
      }
      try {
        await client.navigate(url);
      } catch {
        client.postMessage({ type: 'route', hash: '#/today' });
      }
    })(),
  );
});
