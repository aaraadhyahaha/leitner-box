<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { Undo2 } from '@lucide/svelte';
  import RichText from '../lib/render/RichText.svelte';
  import { call } from '../lib/db/client';
  import type { AnswerResult, Box, Card, DueCursor } from '../lib/db/types';
  import { StudySession } from '../lib/session';
  import { review } from '../lib/leitner';
  import { go } from '../lib/router.svelte';
  import { deckStore, refreshDecks } from '../lib/decks.svelte';
  import { count, fmt } from '../lib/format';

  let { deckId }: { deckId: number } = $props();

  const PAGE = 20;
  const LOW_WATER = 5;
  /** Cards kept rendered behind the active one (depths 1..3; depth 3 is hidden). */
  const PRERENDER = 3;
  /** Stack depths that are visible behind the active card. */
  const VISIBLE_STACK = 2;
  /** Drag past this fraction of the card width commits the answer. */
  const COMMIT_FRACTION = 0.35;
  const DRAG_SLOP = 6;
  /** Tilt in degrees at a drag of one full card width. */
  const MAX_TILT = 12;
  // Mirror --dur-fly, --dur-fade and the chip lead-in (tokens.css §7.10).
  const FLY_MS = 300;
  const FADE_MS = 150;
  const CHIP_LEAD_MS = 160;

  type Side = 'left' | 'right';
  type Enter = 'none' | 'deal' | Side;
  interface Entry {
    uid: number;
    card: Card;
    /** 0 = active, 1..2 visible stack, 3 hidden (pre-rendered). */
    depth: number;
    fly: Side | null;
    box: Box;
    /** The box the chip is animating from, while flying off. */
    prevBox: Box | null;
    enter: Enter;
    delay: number;
  }
  interface FirstAnswer {
    card: Card;
    from: Box;
    to: Box;
    correct: boolean;
  }
  interface Motion {
    fly?: { side: Side; from: Box; to: Box };
    undo?: Side;
  }

  let session = new StudySession<Card>();

  let current = $state.raw<Card | null>(null);
  let entries = $state.raw<Entry[]>([]);
  let nextUid = 1;
  let answered = $state(0);
  let unansweredPending = $state(0);
  let revealed = $state(false);
  let canUndo = $state(false);
  let practice = $state(false);
  let dragging = $state(false);
  /** First answer per card this session (insertion order = study order). */
  const firstAnswers = new SvelteMap<number, FirstAnswer>();
  let lastSide: Side = 'right';
  const timers = new Set<ReturnType<typeof setTimeout>>();

  /** The save of the last persisted answer; null when the last answer wasn't persisted. */
  let lastSave: Promise<AnswerResult> | null = null;
  /** A server-side undo in flight; later answers wait for it so it never sees a newer review. */
  let pendingUndo: Promise<void> | null = null;

  let initialLoaded = $state(false);
  let fetching = $state(false);
  let hasMore = $state(true);
  let initialDue = $state(0);
  let cursor: DueCursor | null = null;
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let leaving = false;

  const deckName = $derived(deckStore.decks.find((d) => d.id === deckId)?.name ?? 'Study');

  type View = 'loading' | 'error' | 'card' | 'empty' | 'done';
  const view: View = $derived.by(() => {
    if (current) return 'card';
    if (!initialLoaded || fetching) return 'loading';
    if (loadError) return 'error';
    return answered === 0 ? 'empty' : 'done';
  });

  const total = $derived(
    hasMore ? Math.max(initialDue, answered + unansweredPending) : answered + unansweredPending,
  );
  const progress = $derived(total > 0 ? Math.min(1, answered / total) : 0);

  const stats = $derived.by(() => {
    let right = 0;
    let wrong = 0;
    let up = 0;
    let down = 0;
    for (const a of firstAnswers.values()) {
      if (a.correct) right++;
      else wrong++;
      if (a.to > a.from) up++;
      else if (a.to < a.from) down++;
    }
    return { right, wrong, up, down };
  });

  const movesLine = $derived.by(() => {
    if (practice) return 'Practice round: boxes weren’t changed.';
    const parts: string[] = [];
    if (stats.up > 0) parts.push(`${count(stats.up, 'card')} moved up`);
    if (stats.down > 0) parts.push(`${fmt(stats.down)} back to Box 1`);
    return parts.length > 0 ? parts.join(' · ') : 'No cards changed boxes.';
  });

  /** A damped spring sampled into a CSS linear() easing; null where linear() is unsupported. */
  function springEasing(zeta = 0.8, settle = 6, steps = 40): string | null {
    if (typeof CSS === 'undefined' || !CSS.supports('transition-timing-function', 'linear(0, 1)')) {
      return null;
    }
    const w = settle / zeta;
    const wd = w * Math.sqrt(1 - zeta * zeta);
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x =
        i === steps
          ? 1
          : 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
      pts.push(x.toFixed(4));
    }
    return `linear(${pts.join(', ')})`;
  }
  const spring = springEasing();

  function reducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  function boxOf(card: Card): Box {
    return firstAnswers.get(card.id)?.to ?? card.box;
  }

  function later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  }

  function makeEntry(card: Card, depth: number, enter: Enter, delay: number): Entry {
    return { uid: nextUid++, card, depth, fly: null, box: boxOf(card), prevBox: null, enter, delay };
  }

  /**
   * Map the session queue onto rendered entries. Entries keep their DOM order
   * (append-only) so moving between depths is a pure CSS transition.
   */
  function reconcile(m: Motion): void {
    const desired = current ? [current, ...session.peek(PRERENDER)] : [];
    const reduce = reducedMotion();
    const delay = m.fly && m.fly.from !== m.fly.to && !reduce ? CHIP_LEAD_MS : 0;
    const used = new Set<number>();
    const assigned = new Map<number, { depth: number; card: Card }>();
    let flyUid: number | null = null;
    if (m.fly) {
      const active = entries.find((e) => e.fly === null && e.depth === 0);
      if (active) {
        flyUid = active.uid;
        used.add(active.uid);
      }
    }
    const created: Entry[] = [];
    desired.forEach((card, depth) => {
      const reuse =
        m.undo && depth === 0
          ? undefined
          : entries.find((e) => e.fly === null && !used.has(e.uid) && e.card.id === card.id);
      if (reuse) {
        used.add(reuse.uid);
        assigned.set(reuse.uid, { depth, card });
      } else {
        const enter: Enter =
          m.undo && depth === 0 ? m.undo : depth <= VISIBLE_STACK ? 'deal' : 'none';
        created.push(makeEntry(card, depth, enter, delay));
      }
    });

    const next: Entry[] = [];
    for (const e of entries) {
      if (e.uid === flyUid && m.fly) {
        const { side, from, to } = m.fly;
        next.push({ ...e, fly: side, box: to, prevBox: from !== to ? from : null, delay });
        const uid = e.uid;
        later(() => {
          entries = entries.filter((x) => x.uid !== uid);
        }, delay + (reduce ? FADE_MS : FLY_MS) + 50);
        continue;
      }
      if (e.fly !== null) {
        if (!m.undo) next.push(e); // an undo replaces anything still in flight
        continue;
      }
      const a = assigned.get(e.uid);
      if (!a) continue;
      next.push({ ...e, card: a.card, depth: a.depth, box: boxOf(a.card), delay });
    }
    entries = [...next, ...created];
  }

  function sync(m: Motion = {}): void {
    current = session.current;
    answered = session.answered;
    canUndo = session.canUndo;
    const queue = current ? [current, ...session.peek(Number.MAX_SAFE_INTEGER)] : [];
    let n = 0;
    for (const c of queue) if (!firstAnswers.has(c.id)) n++;
    unansweredPending = n;
    reconcile(m);
    maybeFetch();
  }

  async function fetchPage(): Promise<void> {
    fetching = true;
    try {
      const cards = await call('study.due', { deckId, after: cursor, limit: PAGE });
      hasMore = cards.length === PAGE;
      const last = cards[cards.length - 1];
      if (last) cursor = { dueDay: last.dueDay, id: last.id };
      session.push(cards);
      loadError = null;
    } catch (e) {
      hasMore = false;
      loadError = errorMessage(e);
    } finally {
      fetching = false;
      initialLoaded = true;
    }
    sync();
  }

  function maybeFetch(): void {
    if (!initialLoaded || fetching || !hasMore || leaving || practice) return;
    if (session.pending < LOW_WATER) void fetchPage();
  }

  function reveal(): void {
    if (!current || revealed) return;
    revealed = true;
  }

  function answer(correct: boolean): void {
    const card = current;
    if (!card || !revealed) return;
    cancelDrag();
    const from = boxOf(card);
    const { persist } = session.answer(correct);
    let to = from;
    lastSave = null;
    if (persist) {
      to = practice ? from : review(from, correct, 0).box;
      firstAnswers.set(card.id, { card, from, to, correct });
      if (!practice) {
        const before = pendingUndo ?? Promise.resolve();
        const save = before.then(() => call('study.answer', { cardId: card.id, correct }));
        lastSave = save;
        save.then(
          () => {
            saveError = null;
          },
          (e: unknown) => {
            saveError = `Couldn’t save the last answer: ${errorMessage(e)}`;
          },
        );
      }
    }
    lastSide = correct ? 'right' : 'left';
    revealed = false;
    sync({ fly: { side: lastSide, from, to } });
  }

  function undo(): void {
    const u = session.undo();
    if (!u) return;
    cancelDrag();
    if (u.persisted) firstAnswers.delete(u.card.id);
    const save = lastSave;
    lastSave = null;
    revealed = false;
    sync({ undo: lastSide });
    if (!u.persisted || !save) return;
    const run = (async () => {
      let reviewId: number;
      try {
        ({ reviewId } = await save);
      } catch {
        // The answer never saved, so there is nothing to undo on disk.
        saveError = null;
        return;
      }
      try {
        await call('study.undo', { reviewId });
        saveError = null;
      } catch (e) {
        saveError = `Couldn’t undo the last answer: ${errorMessage(e)}`;
      }
    })();
    pendingUndo = run;
    void run.finally(() => {
      if (pendingUndo === run) pendingUndo = null;
    });
  }

  /** Go through this session's cards again without changing their boxes. */
  function studyAgain(): void {
    const cards = [...firstAnswers.values()].map((a) => ({ ...a.card, box: a.to }));
    if (cards.length === 0) return;
    session = new StudySession<Card>();
    session.push(cards);
    firstAnswers.clear();
    practice = true;
    hasMore = false;
    lastSave = null;
    revealed = false;
    sync();
  }

  async function exit(): Promise<void> {
    if (leaving) return;
    leaving = true;
    try {
      await refreshDecks();
    } catch {
      // Navigate regardless.
    }
    go({ name: 'deck', deckId });
  }

  // ---- Drag (pointer devices, only after reveal) ----

  interface Drag {
    el: HTMLElement;
    ok: HTMLElement | null;
    bad: HTMLElement | null;
    pointerId: number;
    x0: number;
    y0: number;
    w: number;
    dx: number;
    live: boolean;
    tilt: number;
    raf: number;
  }
  let drag: Drag | null = null;
  let suppressClick = false;

  function clearDragStyles(d: Drag): void {
    if (d.raf) cancelAnimationFrame(d.raf);
    d.raf = 0;
    d.el.style.transform = '';
    d.el.style.transition = '';
    for (const t of [d.ok, d.bad]) {
      if (!t) continue;
      t.style.opacity = '';
      t.style.transition = '';
    }
  }

  function cancelDrag(): void {
    const d = drag;
    if (!d) return;
    drag = null;
    dragging = false;
    if (d.live) clearDragStyles(d);
  }

  function onPointerDown(ev: PointerEvent, e: Entry): void {
    if (e.fly !== null || e.depth !== 0 || !revealed || ev.button !== 0 || !ev.isPrimary) return;
    const el = ev.currentTarget as HTMLElement;
    drag = {
      el,
      ok: el.querySelector<HTMLElement>('.tint.ok'),
      bad: el.querySelector<HTMLElement>('.tint.bad'),
      pointerId: ev.pointerId,
      x0: ev.clientX,
      y0: ev.clientY,
      w: el.getBoundingClientRect().width, // measured once per drag
      dx: 0,
      live: false,
      tilt: reducedMotion() ? 0 : MAX_TILT,
      raf: 0,
    };
  }

  function applyDrag(d: Drag): void {
    d.raf = 0;
    const p = d.dx / d.w;
    d.el.style.transform = `translate3d(${d.dx}px, 0, 0) rotate(${p * d.tilt}deg)`;
    const t = String(Math.min(1, Math.abs(p) / COMMIT_FRACTION));
    if (d.ok) d.ok.style.opacity = d.dx > 0 ? t : '0';
    if (d.bad) d.bad.style.opacity = d.dx < 0 ? t : '0';
  }

  function onPointerMove(ev: PointerEvent): void {
    const d = drag;
    if (!d || ev.pointerId !== d.pointerId) return;
    const dx = ev.clientX - d.x0;
    const dy = ev.clientY - d.y0;
    if (!d.live) {
      if (Math.abs(dy) > DRAG_SLOP && Math.abs(dy) > Math.abs(dx)) {
        drag = null; // vertical: let the content scroll or select
        return;
      }
      if (Math.abs(dx) < DRAG_SLOP) return;
      d.live = true;
      dragging = true;
      d.el.setPointerCapture(ev.pointerId);
      window.getSelection()?.removeAllRanges();
      d.el.style.transition = 'none';
      for (const t of [d.ok, d.bad]) if (t) t.style.transition = 'none';
    }
    d.dx = dx;
    if (!d.raf) d.raf = requestAnimationFrame(() => applyDrag(d));
  }

  function onPointerEnd(ev: PointerEvent, cancelled: boolean): void {
    const d = drag;
    if (!d || ev.pointerId !== d.pointerId) return;
    drag = null;
    if (!d.live) return;
    dragging = false;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    // Clearing the inline styles in the same frame as the class change lets CSS
    // transition from the dragged pose: either flying off or springing back.
    clearDragStyles(d);
    if (!cancelled && Math.abs(d.dx) >= d.w * COMMIT_FRACTION) answer(d.dx > 0);
  }

  function onCardClick(e: Entry): void {
    if (suppressClick || e.fly !== null || e.depth !== 0 || revealed) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // the user was selecting text
    reveal();
  }

  // ---- Keyboard ----

  function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'z'
    ) {
      if (isEditable(event.target) || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditable(event.target)) return;

    if (event.key.toLowerCase() === 'u') {
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (!event.repeat) undo();
      return;
    }

    if (event.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      void exit();
      return;
    }

    if (event.key === ' ' || event.code === 'Space') {
      if (!current) return; // Let Space activate a focused button in the other states.
      // Swallow Space while studying so it never scrolls or re-activates a focused button.
      event.preventDefault();
      if (!event.repeat && !revealed) reveal();
      return;
    }

    if (!current || !revealed || event.repeat) return;
    if (event.key === 'ArrowRight' || event.key === '2') {
      event.preventDefault();
      answer(true);
    } else if (event.key === 'ArrowLeft' || event.key === '1') {
      event.preventDefault();
      answer(false);
    }
  }

  onMount(() => {
    initialDue = deckStore.decks.find((d) => d.id === deckId)?.due ?? 0;
    void fetchPage();
  });

  onDestroy(() => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    cancelDrag();
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet chip(e: Entry)}
  <span class="chip-wrap">
    {#if e.prevBox !== null}
      <span class="chip b{e.prevBox} chip-out" aria-hidden="true">Box {e.prevBox}</span>
    {/if}
    <span class="chip b{e.box}" class:chip-in={e.prevBox !== null}>Box {e.box}</span>
  </span>
{/snippet}

<div class="study" style:--ease-spring={spring}>
  <header class="bar">
    <div class="bar-start">
      <button type="button" class="btn btn-toolbar" onclick={() => void exit()}>Done</button>
    </div>
    <p class="counter" aria-live="polite">
      {#if total > 0}
        {#key answered}<span class="num">{fmt(answered)}</span>{/key}
        <span class="of">of {fmt(total)}</span>
      {/if}
    </p>
    <div class="bar-end">
      <button
        type="button"
        class="btn btn-toolbar"
        disabled={!canUndo}
        title="Undo last answer"
        onclick={undo}
      >
        <Undo2 size={16} strokeWidth={1.5} aria-hidden="true" />
        <span>Undo</span>
      </button>
    </div>
    <div
      class="progress"
      role="progressbar"
      aria-label="Session progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={answered}
    >
      <div class="progress-fill" style:transform="scaleX({progress})"></div>
    </div>
  </header>

  <div class="stage" class:dragging>
    <div class="deck">
      {#each entries as e (e.uid)}
        {@const active = e.fly === null && e.depth === 0}
        {@const shown = e.fly !== null || (active && revealed)}
        <!-- Pointer and click are shortcuts; Space and the buttons below do the same. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="slot d{e.depth}"
          class:active
          class:revealed={shown}
          class:fly-left={e.fly === 'left'}
          class:fly-right={e.fly === 'right'}
          class:enter-deal={e.enter === 'deal'}
          class:enter-left={e.enter === 'left'}
          class:enter-right={e.enter === 'right'}
          style:--delay="{e.delay}ms"
          inert={!active}
          onpointerdown={(ev) => onPointerDown(ev, e)}
          onpointermove={onPointerMove}
          onpointerup={(ev) => onPointerEnd(ev, false)}
          onpointercancel={(ev) => onPointerEnd(ev, true)}
          onclick={() => onCardClick(e)}
        >
          <div class="lift">
            <div class="flipper">
              <section class="face front" inert={shown} aria-label="Question">
                <div class="face-head">
                  {@render chip(e)}
                  <span class="deck-name" title={deckName}>{deckName}</span>
                </div>
                <div class="face-body">
                  <div class="face-content"><RichText source={e.card.front} /></div>
                </div>
                <div class="face-foot" aria-hidden="true">Question</div>
              </section>
              <section class="face back" inert={!shown} aria-label="Answer">
                <span class="tint ok" aria-hidden="true"></span>
                <span class="tint bad" aria-hidden="true"></span>
                <div class="face-head">
                  {@render chip(e)}
                  <span class="deck-name" title={deckName}>{deckName}</span>
                </div>
                <div class="face-body">
                  <div class="face-content"><RichText source={e.card.back} /></div>
                </div>
                <div class="face-foot" aria-hidden="true">Answer</div>
              </section>
            </div>
          </div>
          <div class="dim" aria-hidden="true"></div>
        </div>
      {/each}

      {#if view === 'done'}
        <div class="slot d0 summary">
          <div class="lift">
            <div class="flipper">
              <section class="face front" aria-label="Session summary">
                <div class="face-head">
                  <span></span>
                  <span class="deck-name" title={deckName}>{deckName}</span>
                </div>
                <div class="face-body">
                  <div class="face-content summary-content">
                    <h2 class="summary-title">
                      {practice ? 'Practice Complete' : 'Session Complete'}
                    </h2>
                    <div class="tallies">
                      <div class="tally">
                        <span class="tally-n tally-right">{fmt(stats.right)}</span>
                        <span class="tally-l">Right</span>
                      </div>
                      <div class="tally">
                        <span class="tally-n tally-wrong">{fmt(stats.wrong)}</span>
                        <span class="tally-l">Wrong</span>
                      </div>
                    </div>
                    <p class="moves">{movesLine}</p>
                    <div class="summary-actions">
                      <button type="button" class="btn" onclick={() => void exit()}>Done</button>
                      <button type="button" class="btn btn-primary" onclick={studyAgain}>
                        Study Again
                      </button>
                    </div>
                  </div>
                </div>
                <div class="face-foot" aria-hidden="true">Summary</div>
              </section>
              <section class="face back" inert aria-hidden="true"></section>
            </div>
          </div>
        </div>
      {/if}
    </div>

    {#if view === 'loading' && entries.length === 0 && answered === 0}
      <div class="empty-state" role="status">
        <p class="empty-state-message">Loading…</p>
      </div>
    {:else if view === 'error'}
      <div class="empty-state" role="alert">
        <p class="empty-state-title">Couldn’t Load Cards</p>
        <p class="empty-state-message">{loadError}</p>
        <button type="button" class="btn" onclick={() => void exit()}>Back to Deck</button>
      </div>
    {:else if view === 'empty'}
      <div class="empty-state">
        <p class="empty-state-title">Nothing Due</p>
        <p class="empty-state-message">No cards in this deck are due today.</p>
        <button type="button" class="btn" onclick={() => void exit()}>Back to Deck</button>
      </div>
    {/if}
  </div>

  <div class="controls">
    <p class="warning" role="alert">
      {#if saveError}
        {saveError}
      {:else if loadError && view === 'card'}
        Couldn’t load more cards: {loadError}
      {/if}
    </p>
    <div class="buttons">
      {#if view === 'card'}
        {#if !revealed}
          <button type="button" class="btn btn-large answer-btn" onclick={reveal}>
            Show Answer <kbd class="key">Space</kbd>
          </button>
        {:else}
          <button type="button" class="btn btn-large answer-btn wrong" onclick={() => answer(false)}>
            Wrong <kbd class="key">←</kbd>
          </button>
          <button type="button" class="btn btn-large answer-btn right" onclick={() => answer(true)}>
            Right <kbd class="key">→</kbd>
          </button>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .study {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    /* Fill the whole main area: the stage is a size container with no intrinsic
       height, so it would collapse in the parent's `auto` row. */
    grid-row: 1 / -1;
    height: 100%;
    min-height: 0;
    background: var(--study-bg);
  }

  /* ---- Top bar ---- */

  .bar {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: var(--toolbar-height);
    padding: 0 var(--s4);
    background: var(--bg-content);
    border-bottom: var(--hairline) solid var(--separator);
  }

  .bar-start {
    justify-self: start;
  }

  .bar-end {
    justify-self: end;
  }

  .counter {
    display: inline-flex;
    gap: var(--s1);
    overflow: hidden;
    font: var(--text-headline) var(--font-system);
    font-variant-numeric: tabular-nums;
    color: var(--label);
  }

  .num {
    display: inline-block;
    animation: count-in var(--dur-rise) var(--ease) backwards;
  }

  .of {
    font-weight: 400;
    color: var(--label-secondary);
  }

  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(-1 * var(--hairline));
    height: var(--progress-height);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transform-origin: 0 50%;
    transition: transform var(--dur-progress) var(--ease);
  }

  /* ---- Stage and stack ---- */

  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
    overflow: hidden;
    container-type: size;
  }

  .stage > * {
    grid-area: 1 / 1;
  }

  .deck {
    display: grid;
    width: clamp(
      var(--card-min-w),
      min(
        100cqw - 2 * var(--s8),
        (100cqh - 2 * var(--s8) - 2 * var(--stack-step)) * var(--card-aspect)
      ),
      var(--card-max-w)
    );
    aspect-ratio: var(--card-aspect);
  }

  .stage.dragging {
    user-select: none;
    -webkit-user-select: none;
  }

  .stage.dragging :global(.rich-text) {
    user-select: none;
    -webkit-user-select: none;
  }

  .slot {
    --delay: 0ms;
    grid-area: 1 / 1;
    position: relative;
    min-width: 0;
    min-height: 0;
    transform-origin: 50% 100%;
    transition:
      transform var(--dur-rise) var(--ease-spring, var(--ease-flip)) var(--delay),
      opacity var(--dur-rise) linear var(--delay);
    will-change: transform, opacity;
  }

  .d0 {
    z-index: 4;
  }

  .d1 {
    z-index: 3;
    transform: translateY(var(--stack-step)) scale(0.96);
  }

  .d2 {
    z-index: 2;
    transform: translateY(calc(2 * var(--stack-step))) scale(0.92);
  }

  .d3 {
    z-index: 1;
    transform: translateY(calc(3 * var(--stack-step))) scale(0.88);
    opacity: 0;
  }

  .slot.active.revealed {
    cursor: grab;
    touch-action: pan-y;
  }

  .stage.dragging .slot.active {
    cursor: grabbing;
  }

  .fly-left,
  .fly-right {
    z-index: 5;
    opacity: 0;
    pointer-events: none;
    transition:
      transform var(--dur-fly) var(--ease-fly) var(--delay),
      opacity var(--dur-fly) var(--ease-fly) var(--delay);
  }

  .fly-right {
    transform: translate3d(calc(50cqw + 60%), calc(-1 * var(--s6)), 0) rotate(8deg);
  }

  .fly-left {
    transform: translate3d(calc(-50cqw - 60%), calc(-1 * var(--s6)), 0) rotate(-8deg);
  }

  .enter-deal {
    animation: deal var(--dur-rise) var(--ease-spring, var(--ease-flip)) var(--delay) backwards;
  }

  .enter-left {
    animation: in-left var(--dur-fly) var(--ease-flip) backwards;
  }

  .enter-right {
    animation: in-right var(--dur-fly) var(--ease-flip) backwards;
  }

  .lift {
    width: 100%;
    height: 100%;
    perspective: var(--card-perspective);
    transition: transform var(--dur-hover) var(--ease);
  }

  .flipper {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
    transition: transform var(--dur-flip) var(--ease-spring, var(--ease-flip));
  }

  .active .flipper {
    will-change: transform;
  }

  .slot.revealed .flipper {
    transform: rotateY(180deg);
  }

  .dim {
    position: absolute;
    inset: calc(-1 * var(--hairline));
    border-radius: var(--card-radius);
    background: var(--stack-dim);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-rise) linear var(--delay);
  }

  .d1 .dim {
    opacity: 0.5;
  }

  .d2 .dim,
  .d3 .dim {
    opacity: 1;
  }

  @media (hover: hover) {
    .stage:not(.dragging) .slot.active:hover .lift {
      transform: translateY(-2px);
    }

    .stage:not(.dragging) .slot.active:hover .face::after {
      opacity: 1;
    }
  }

  /* ---- Card faces ---- */

  .face {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    padding: var(--s4) var(--s5);
    background: var(--card-bg);
    border: var(--hairline) solid var(--card-border);
    border-radius: var(--card-radius);
    box-shadow: var(--shadow-card);
    color: var(--label);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }

  .face.back {
    transform: rotateY(180deg);
  }

  .face::after {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--hairline));
    border-radius: inherit;
    box-shadow: var(--shadow-card-hover);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-hover) var(--ease);
  }

  .face-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
    min-height: var(--chip-height);
  }

  .deck-name {
    min-width: 0;
    font: var(--text-callout) var(--font-system);
    color: var(--label-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .face-body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--s4) var(--s3);
  }

  .face-content {
    /* Centred when it fits; scrolls from the top when it doesn't. */
    margin-block: auto;
    font: var(--text-card) var(--font-system);
    text-align: center;
    overflow-wrap: anywhere;
  }

  .face-foot {
    font: var(--text-footnote) var(--font-system);
    color: var(--label-tertiary);
    text-align: center;
  }

  .chip-wrap {
    display: inline-grid;
    flex: none;
  }

  .chip {
    grid-area: 1 / 1;
    display: inline-flex;
    align-items: center;
    height: var(--chip-height);
    padding: 0 var(--s2);
    border-radius: calc(var(--chip-height) / 2);
    font: var(--text-subhead) var(--font-system);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: color-mix(in srgb, var(--chip-c) 70%, var(--label));
    background: color-mix(in srgb, var(--chip-c) 16%, transparent);
  }

  .b1 {
    --chip-c: var(--box-1);
  }
  .b2 {
    --chip-c: var(--box-2);
  }
  .b3 {
    --chip-c: var(--box-3);
  }
  .b4 {
    --chip-c: var(--box-4);
  }
  .b5 {
    --chip-c: var(--box-5);
  }

  .chip-out {
    animation: chip-out var(--dur-chip) var(--ease) forwards;
  }

  .chip-in {
    animation: chip-in var(--dur-chip) var(--ease) backwards;
  }

  .tint {
    position: absolute;
    inset: calc(-1 * var(--hairline));
    border-radius: inherit;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-tint) var(--ease);
  }

  .tint.ok {
    box-shadow: inset 0 0 0 var(--edge-width) var(--green);
    background: color-mix(in srgb, var(--green) 6%, transparent);
  }

  .tint.bad {
    box-shadow: inset 0 0 0 var(--edge-width) var(--red);
    background: color-mix(in srgb, var(--red) 6%, transparent);
  }

  .fly-right .tint.ok,
  .fly-left .tint.bad {
    opacity: 1;
  }

  /* ---- Summary card ---- */

  .summary {
    animation: deal var(--dur-rise) var(--ease-spring, var(--ease-flip)) backwards;
  }

  .summary .flipper {
    animation: flip-in var(--dur-flip) var(--ease-spring, var(--ease-flip))
      calc(var(--dur-fly) / 2) backwards;
  }

  .summary-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s4);
  }

  .summary-title {
    font: var(--text-title1) var(--font-system);
    color: var(--label);
  }

  .tallies {
    display: flex;
    gap: var(--s8);
  }

  .tally {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s1);
  }

  .tally-n {
    font: var(--text-large-title) var(--font-system);
    font-variant-numeric: tabular-nums;
  }

  .tally-right {
    color: var(--green);
  }

  .tally-wrong {
    color: var(--red);
  }

  .tally-l {
    font: var(--text-footnote) var(--font-system);
    color: var(--label-secondary);
  }

  .moves {
    font: var(--text-callout) var(--font-system);
    color: var(--label-secondary);
  }

  .summary-actions {
    display: flex;
    gap: var(--s2);
  }

  /* ---- Controls ---- */

  .controls {
    display: grid;
    grid-template-rows: var(--warning-line) var(--answer-height);
    gap: var(--s2);
    justify-items: center;
    padding: 0 var(--s4) var(--s6);
  }

  .warning {
    max-width: 100%;
    font: var(--text-callout) var(--font-system);
    color: var(--orange);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .buttons {
    display: flex;
    gap: var(--s3);
    width: min(var(--controls-width), 100%);
  }

  .answer-btn {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s2);
  }

  .key {
    display: inline-flex;
    align-items: center;
    min-width: var(--s5);
    height: var(--s4);
    padding: 0 var(--s1);
    justify-content: center;
    border: var(--hairline) solid var(--control-border);
    border-radius: var(--radius-row);
    font: var(--text-footnote) var(--font-system);
    color: var(--label-secondary);
  }

  .wrong {
    color: var(--red);
    background: color-mix(in srgb, var(--red) 10%, var(--bg-control));
    border-color: color-mix(in srgb, var(--red) 30%, transparent);
  }

  .right {
    color: var(--green);
    background: color-mix(in srgb, var(--green) 10%, var(--bg-control));
    border-color: color-mix(in srgb, var(--green) 30%, transparent);
  }

  .wrong .key,
  .right .key {
    color: inherit;
    border-color: currentColor;
    opacity: 0.6;
  }

  /* ---- Keyframes ---- */

  @keyframes count-in {
    from {
      transform: translateY(50%);
      opacity: 0;
    }
  }

  @keyframes deal {
    from {
      transform: translateY(calc(3 * var(--stack-step))) scale(0.88);
      opacity: 0;
    }
  }

  @keyframes in-left {
    from {
      transform: translate3d(calc(-50cqw - 60%), calc(-1 * var(--s6)), 0) rotate(-8deg);
      opacity: 0;
    }
  }

  @keyframes in-right {
    from {
      transform: translate3d(calc(50cqw + 60%), calc(-1 * var(--s6)), 0) rotate(8deg);
      opacity: 0;
    }
  }

  @keyframes flip-in {
    from {
      transform: rotateY(-180deg);
    }
  }

  @keyframes chip-out {
    to {
      transform: translateY(-60%);
      opacity: 0;
    }
  }

  @keyframes chip-in {
    from {
      transform: translateY(60%);
      opacity: 0;
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  /* ---- Reduced motion: no flip, tilt or flight; 150 ms crossfades ---- */

  @media (prefers-reduced-motion: reduce) {
    .slot,
    .fly-left,
    .fly-right {
      transition: opacity var(--dur-fade) linear;
    }

    .fly-left,
    .fly-right {
      transform: none;
    }

    .enter-deal,
    .enter-left,
    .enter-right,
    .summary {
      animation: fade-in var(--dur-fade) linear backwards;
    }

    .flipper,
    .slot.revealed .flipper,
    .summary .flipper {
      transform: none;
      transition: none;
      animation: none;
    }

    .face {
      transition: opacity var(--dur-fade) linear;
    }

    .face.back {
      transform: none;
      opacity: 0;
    }

    .slot.revealed .face.back {
      opacity: 1;
    }

    .slot.revealed .face.front {
      opacity: 0;
    }

    .summary .face.back {
      display: none;
    }

    .lift,
    .progress-fill {
      transition: none;
    }

    .stage:not(.dragging) .slot.active:hover .lift {
      transform: none;
    }

    .num,
    .chip-in {
      animation: none;
    }

    .chip-out {
      display: none;
    }
  }
</style>
