/**
 * Performance harness, loaded only with `?perf` in the URL (see main.ts).
 * Console API on `window.__perf`; nothing is logged unless a function is called.
 *   await __perf.importFile('./bench-100k.jsonl')   // times import.run (commit)
 *   await __perf.queries()                           // deck list, paging, search, study
 *   await __perf.deleteBatch(id)                     // times batch.delete
 *   await __perf.scroll()                            // scroll the open card list for 5 s
 */
import { call } from './db/client';
import type { Card, CardQuery, DeckSummary } from './db/types';
import { renderToHtml } from './render/render';

type Row = Record<string, number | string>;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
const ms = (n: number) => Math.round(n * 100) / 100;

async function time<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const t0 = performance.now();
  const r = await fn();
  return [performance.now() - t0, r];
}

async function med(fn: () => Promise<unknown>, runs = 20): Promise<number> {
  await fn(); // warm-up
  const xs: number[] = [];
  for (let i = 0; i < runs; i++) xs.push((await time(fn))[0]);
  return ms(median(xs));
}

/** Imports a URL (fetched first, not timed) or a File, e.g. from `$0.files[0]` on a file input. */
async function importFile(src: string | File, defaultDeck = 'Imported'): Promise<Row> {
  const [tFetch, file] = await time(async () =>
    typeof src === 'string' ? new File([await (await fetch(src)).blob()], src.split('/').pop() ?? 'bench.jsonl') : src,
  );
  const [t, res] = await time(() => call('import.run', { file, defaultDeck, commit: true }));
  const row = { fetchMs: ms(tFetch), importMs: ms(t), added: res.added, duplicates: res.duplicates, batchId: res.batchId ?? -1 };
  console.table([row]);
  return row;
}

async function deleteBatch(id: number): Promise<Row> {
  const [t, res] = await time(() => call('batch.delete', { id }));
  const row = { deleteMs: ms(t), deleted: res.deleted };
  console.table([row]);
  return row;
}

async function queries(): Promise<Row> {
  const decks: DeckSummary[] = await call('deck.list', null);
  const big = decks.reduce((a, b) => (b.total > a.total ? b : a));
  const q = (search: string): CardQuery => ({ deckId: big.id, search, box: null });
  const out: Row = { deck: big.name, deckCards: big.total };

  out['deck.list'] = await med(() => call('deck.list', null));
  out['card.list p1'] = await med(() => call('card.list', { query: q(''), after: null, limit: 200 }));
  // cursor for page 10
  let after = null;
  for (let i = 0; i < 9; i++) after = (await call('card.list', { query: q(''), after, limit: 200 })).next;
  out['card.list p10'] = await med(() => call('card.list', { query: q(''), after, limit: 200 }));
  out['card.list box 3'] = await med(() =>
    call('card.list', { query: { ...q(''), box: 3 }, after: null, limit: 200 }),
  );
  for (const [label, s] of [['common', 'energy'], ['rare', 'zyzzyva'], ['two-term', 'energy acid']]) {
    out[`search ${label}`] = await med(() => call('card.list', { query: q(s), after: null, limit: 200 }));
    out[`count ${label}`] = await med(() => call('card.count', q(s)));
  }
  out['count all'] = await med(() => call('card.count', q('')));
  out['habit.summary'] = await med(() => call('habit.summary', null));
  out['study.due 20'] = await med(() => call('study.due', { deckId: big.id, after: null, limit: 20 }));

  // Render 20 uncached cards (front + back), as the study view pre-renders them.
  const due: Card[] = await call('study.due', { deckId: big.id, after: null, limit: 200 });
  const sample = due.slice(100, 120);
  const [tr] = await time(async () => {
    for (const c of sample) {
      renderToHtml(c.front);
      renderToHtml(c.back);
    }
  });
  out['render per card'] = ms(tr / Math.max(1, sample.length));

  // Answer + undo round trip (leaves the data unchanged).
  const card = due[0];
  const answers: number[] = [];
  for (let i = 0; i < 10; i++) {
    const [ta, r] = await time(() => call('study.answer', { cardId: card.id, correct: true }));
    answers.push(ta);
    await call('study.undo', { reviewId: r.reviewId });
  }
  out['study.answer'] = ms(median(answers));
  console.table(Object.entries(out).map(([k, v]) => ({ metric: k, value: v })));
  return out;
}

/** Scrolls the card list by `step` px per frame for `seconds` (pages load as it goes). */
function scroll(step = 400, seconds = 5): Promise<Row> {
  const el = document.querySelector<HTMLElement>('.virtual-list');
  if (!el) return Promise.reject(new Error('Open a deck first'));
  el.scrollTop = 0;
  return new Promise((resolve) => {
    const frames: number[] = [];
    let last = performance.now();
    const t0 = last;
    const tick = (now: number) => {
      frames.push(now - last);
      last = now;
      el.scrollTop += step;
      if (now - t0 < seconds * 1000) requestAnimationFrame(tick);
      else {
        frames.shift();
        const row = {
          frames: frames.length,
          worstMs: ms(Math.max(...frames)),
          p95Ms: ms([...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.95)]),
          over20: `${Math.round((frames.filter((f) => f > 20).length / frames.length) * 100)}%`,
          scrolledTo: Math.round(el.scrollTop),
        };
        console.table([row]);
        resolve(row);
      }
    };
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(tick);
    });
  });
}

const api = { importFile, queries, deleteBatch, scroll };
(window as unknown as { __perf: typeof api }).__perf = api;
export default api;
