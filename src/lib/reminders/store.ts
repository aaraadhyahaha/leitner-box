// IndexedDB `leitner-reminders` / `kv`, shared with the service worker. Never throws.
import { DEFAULT_PREFS, type ReminderPrefs, type Snapshot } from './core';

const DB_NAME = 'leitner-reminders';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await open();
  try {
    return await result<T | undefined>(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
  } finally {
    db.close();
  }
}

/** Read-modify-write in one readwrite transaction. */
async function update<T>(key: string, fn: (old: T | undefined) => T | undefined): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => {
      const next = fn(req.result as T | undefined);
      if (next !== undefined) store.put(next, key);
    };
    await done(tx);
  } finally {
    db.close();
  }
}

export async function getPrefs(): Promise<ReminderPrefs> {
  try {
    const p = await get<Partial<ReminderPrefs>>('prefs');
    return {
      time: typeof p?.time === 'string' ? p.time : DEFAULT_PREFS.time,
      notify: typeof p?.notify === 'boolean' ? p.notify : DEFAULT_PREFS.notify,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function setPrefs(p: ReminderPrefs): Promise<void> {
  try {
    await update<ReminderPrefs>('prefs', () => ({ time: p.time, notify: p.notify }));
  } catch { /* storage unavailable */ }
}

export async function getSnapshot(): Promise<Snapshot | null> {
  try {
    return (await get<Snapshot>('snapshot')) ?? null;
  } catch {
    return null;
  }
}

/** Keeps the stored `notifiedDay` (null if none). */
export async function writeSnapshot(s: Omit<Snapshot, 'notifiedDay'>): Promise<void> {
  try {
    await update<Snapshot>('snapshot', (old) => ({ ...s, notifiedDay: old?.notifiedDay ?? null }));
  } catch { /* storage unavailable */ }
}

export async function markNotified(day: number): Promise<void> {
  try {
    await update<Snapshot>('snapshot', (old) => (old ? { ...old, notifiedDay: day } : undefined));
  } catch { /* storage unavailable */ }
}
