<script lang="ts">
  import { untrack } from 'svelte';
  import VirtualList from './VirtualList.svelte';
  import { call } from '../lib/db/client';
  import type { Card, CardQuery, DueCursor } from '../lib/db/types';

  let {
    query,
    refreshKey = '',
    onopen,
  }: {
    query: CardQuery;
    refreshKey?: string | number;
    onopen?: (card: Card) => void;
  } = $props();

  const PAGE = 200;

  let cards: Card[] = $state.raw([]);
  let next: DueCursor | null = $state(null);
  let loading = $state(false);
  let loaded = $state(false);
  let error: string | null = $state(null);
  let generation = 0;

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
      items={cards}
      rowHeight={28}
      onnearend={loadMore}
      class="card-list-scroller"
      role="listbox"
      tabindex={0}
      aria-label="Cards"
      {ondblclick}
    >
      {#snippet row(card: Card, i: number)}
        {@const front = plain(card.front)}
        {@const back = plain(card.back)}
        <div class="list-row card-row" role="option" aria-selected="false" data-index={i}>
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
