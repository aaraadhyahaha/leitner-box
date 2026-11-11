<script lang="ts">
  import { untrack } from 'svelte';
  import VirtualList from './VirtualList.svelte';
  import { call } from '../lib/db/client';
  import type { Card, CardQuery, DueCursor } from '../lib/db/types';
  import type { Selection } from '../lib/selection.svelte';

  let {
    query,
    selection,
    refreshKey = '',
    onopen,
    ondelete,
  }: {
    query: CardQuery;
    selection: Selection;
    refreshKey?: string | number;
    onopen?: (card: Card) => void;
    ondelete?: () => void;
  } = $props();

  const PAGE = 200;

  let cards: Card[] = $state.raw([]);
  let next: DueCursor | null = $state.raw(null); // raw: a proxy cannot be posted to the worker
  let loading = $state(false);
  let loaded = $state(false);
  let error: string | null = $state(null);
  let generation = 0;

  const uid = `card-list-${Math.random().toString(36).slice(2, 8)}`;
  let list: VirtualList<Card> | undefined = $state();

  // Keyboard cursor row index; -1 when there is none.
  let cursor = $state(-1);
  const activeIndex = $derived(cursor >= 0 && cursor < cards.length ? cursor : -1);

  const filtered = $derived(query.search.trim() !== '' || query.box !== null);

  async function load(reset: boolean) {
    if (loading && !reset) return;
    const gen = generation;
    const q: CardQuery = { deckId: query.deckId, search: query.search, box: query.box };
    loading = true;
    error = null;
    try {
      const page = await call('card.list', { query: q, after: reset ? null : next, limit: PAGE });
      if (gen !== generation) return;
      cards = reset ? page.cards : cards.concat(page.cards);
      next = page.next;
      loaded = true;
    } catch (e) {
      if (gen !== generation) return;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (gen === generation) loading = false;
    }
  }

  $effect(() => {
    // Track the query fields and the refresh key.
    void query.deckId;
    void query.search;
    void query.box;
    void refreshKey;
    untrack(() => {
      generation++;
      cards = [];
      next = null;
      loaded = false;
      loading = false;
      error = null;
      load(true);
    });
  });

  // A new query clears the selection and the cursor.
  $effect(() => {
    void query.deckId;
    void query.search;
    void query.box;
    untrack(() => {
      selection.clear();
      cursor = -1;
    });
  });

  function loadMore() {
    if (loading || error || next === null) return;
    load(false);
  }

  function retry() {
    load(cards.length === 0);
  }

  function plain(s: string): string {
    return s.replace(/\s*[\r\n]+\s*/g, ' ');
  }

  function ondblclick(e: MouseEvent) {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-index]') : null;
    if (!el) return;
    const card = cards[Number(el.dataset.index)];
    if (card) onopen?.(card);
  }

  function rowId(id: number): string {
    return `${uid}-${id}`;
  }

  function idAt(i: number): number {
    return cards[i].id;
  }

  function onclick(e: MouseEvent) {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-index]') : null;
    if (!el) return;
    const index = Number(el.dataset.index);
    if (!cards[index]) return;
    selection.click(index, idAt, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });
    cursor = index;
  }

  function moveTo(index: number, extend: boolean) {
    if (cards.length === 0) return;
    const i = Math.max(0, Math.min(index, cards.length - 1));
    selection.click(i, idAt, { toggle: false, range: extend });
    cursor = i;
    list?.scrollToIndex(i);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.altKey) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      if (!e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selection.selectAll();
      }
      return;
    }
    const current = activeIndex;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(current < 0 ? 0 : current + 1, e.shiftKey);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(current < 0 ? 0 : current - 1, e.shiftKey);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0, e.shiftKey);
        break;
      case 'End':
        e.preventDefault();
        moveTo(cards.length - 1, e.shiftKey);
        break;
      case 'Enter': {
        if (e.shiftKey || selection.state.mode !== 'ids' || selection.state.ids.size !== 1) return;
        const [id] = selection.state.ids;
        const card = cards.find((c) => c.id === id);
        if (!card) return;
        e.preventDefault();
        onopen?.(card);
        break;
      }
      case 'Delete':
      case 'Backspace':
        if (selection.toRequest(query) === null) return;
        e.preventDefault();
        ondelete?.();
        break;
      case 'Escape':
        if (selection.toRequest(query) === null) return;
        e.preventDefault();
        selection.clear();
        break;
    }
  }
</script>

<div class="card-list">
  {#if error}
    <p class="card-list-error">
      <span class="field-error">Couldn’t load cards: {error}</span>
      <button type="button" class="btn" onclick={retry}>Retry</button>
    </p>
  {/if}
  {#if loaded && cards.length === 0}
    <div class="empty-state">
      {#if filtered}
        <p class="empty-state-title">No Results</p>
      {:else}
        <p class="empty-state-title">No Cards</p>
        <p class="empty-state-message">Import a file or add a card.</p>
      {/if}
    </div>
  {:else}
    <VirtualList
      bind:this={list}
      items={cards}
      rowHeight={28}
      onnearend={loadMore}
      class="card-list-scroller"
      role="listbox"
      tabindex={0}
      aria-label="Cards"
      aria-multiselectable="true"
      aria-activedescendant={activeIndex >= 0 ? rowId(cards[activeIndex].id) : undefined}
      {onclick}
      {ondblclick}
      {onkeydown}
    >
      {#snippet row(card: Card, i: number)}
        {@const front = plain(card.front)}
        {@const back = plain(card.back)}
        {@const selected = selection.has(card.id)}
        <div
          id={rowId(card.id)}
          class="list-row card-row"
          class:selected
          class:cursor={i === activeIndex}
          role="option"
          aria-selected={selected}
          data-index={i}
        >
          <span class="card-front" title={front}>{front}</span>
          <span class="card-back" title={back}>{back}</span>
          <span class="card-box">Box {card.box}</span>
        </div>
      {/snippet}
    </VirtualList>
  {/if}
</div>

<style>
  .card-list {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .card-list-error {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex: none;
    padding: var(--s1) var(--s4);
    border-bottom: var(--hairline) solid var(--separator);
  }

  .card-list :global(.card-list-scroller) {
    flex: 1 1 auto;
  }

  .card-list :global(.card-list-scroller:focus-visible) {
    outline-offset: calc(-1 * var(--focus-width));
  }

  .card-row {
    font: var(--text-body) var(--font-system);
    cursor: default;
    -webkit-user-select: none;
    user-select: none;
  }

  /* Keyboard cursor on a row that is not selected. */
  :global(.card-list-scroller:focus) .card-row.cursor:not(.selected) {
    outline: 1px solid var(--focus-ring);
    outline-offset: -1px;
  }

  .card-front,
  .card-back {
    flex: 1 1 0;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-back {
    color: var(--label-secondary);
  }

  .card-box {
    flex: none;
    width: calc(var(--s8) + var(--s4));
    text-align: right;
    font: var(--text-footnote) var(--font-system);
    color: var(--label-secondary);
    font-variant-numeric: tabular-nums;
  }
</style>
