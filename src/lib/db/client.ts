import type { Api, Op, WireRequest, WireResponse } from './types';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function rejectAll(msg: string): void {
  const err = new Error(msg);
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<WireResponse>) => {
    const res = ev.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result);
    else p.reject(new Error(res.error));
  };
  w.onerror = (ev: ErrorEvent) => {
    rejectAll(ev.message || 'Database worker failed');
  };
  worker = w;
  return w;
}

export function call<K extends Op>(op: K, args: Api[K]['req']): Promise<Api[K]['res']> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<Api[K]['res']>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    const req: WireRequest = { id, op, args };
    w.postMessage(req);
  });
}
