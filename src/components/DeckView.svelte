<script lang="ts">
  import Toolbar from './Toolbar.svelte';
  import ImportButton from './ImportButton.svelte';
  import SearchField from './SearchField.svelte';
  import Segmented from './Segmented.svelte';
  import CardList from './CardList.svelte';
  import { call } from '../lib/db/client';
  import type { Box, CardQuery } from '../lib/db/types';
  import { deckStore } from '../lib/decks.svelte';
  import { go } from '../lib/router.svelte';

  let { deckId }: { deckId: number } = $props();

  const deck = $derived(deckStore.decks.find((d) => d.id === deckId) ?? null);

  let search = $state('');
  let boxValue = $state('all');
  let searchField: SearchField | undefined = $state();

  const box: Box | null = $derived(boxValue === 'all' ? null : (Number(boxValue) as Box));
  const query: CardQuery = $derived({ deckId, search, box });
  const filtered = $derived(search.trim() !== '' || box !== null);

  const boxOptions = $derived(
    deck
      ? [
          { value: 'all', label: 'All', count: deck.total },
          ...deck.boxes.map((count, i) => ({ value: String(i + 1), label: `Box ${i + 1}`, count })),
        ]
      : [],
  );

  const refreshKey = $derived(deck ? `${deck.total}:${deck.boxes.join()}` : '');

  const subtitle = $derived(
    deck ? `${deck.total === 1 ? '1 card' : `${deck.total} cards`} · ${deck.due} due` : '',
  );

  // Reset search and filter when switching decks.
  let lastDeckId: number | null = null;
  $effect.pre(() => {
    if (lastDeckId !== null && deckId !== lastDeckId) {
      search = '';
      boxValue = 'all';
    }
    lastDeckId = deckId;
  });

  // "N matching" while a search or filter is active; stale responses are dropped.
  let matching: number | null = $state(null);
  let countGen = 0;
  $effect(() => {
    const q: CardQuery = { deckId: query.deckId, search: query.search, box: query.box };
    const active = filtered;
    void refreshKey;
    const gen = ++countGen;
    matching = null;
    if (!active) return;
    call('card.count', q).then(
      (n) => {
        if (gen === countGen) matching = n;
      },
      () => {
        if (gen === countGen) matching = null;
      },
    );
  });

  function study() {
    if (!deck || deck.due === 0) return;
    go({ name: 'study', deckId });
  }

  function isTyping(t: EventTarget | null): boolean {
    return t instanceof Element && t.closest('input, textarea, select, [contenteditable]') !== null;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') {
      if (isTyping(e.target)) return;
      if (e.target instanceof Element && e.target.closest('dialog')) return;
      if (!deck) return;
      e.preventDefault();
      searchField?.focus();
      return;
    }
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (t instanceof Element) {
      if (t.closest('input, textarea, select, button, [contenteditable], [role="listbox"], dialog')) return;
    }
    if (!deck || deck.due === 0) return;
    e.preventDefault();
    study();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if deck}
  <Toolbar title={deck.name} {subtitle}>
    <SearchField bind:this={searchField} bind:value={search} placeholder="Search" />
    <ImportButton deckName={deck.name} />
    <button type="button" class="btn btn-primary" disabled={deck.due === 0} onclick={study}>
      Study
    </button>
  </Toolbar>
  <div class="deck-body">
    <div class="filter-bar">
      <Segmented bind:value={boxValue} options={boxOptions} label="Box filter" />
      <p class="filter-status" aria-live="polite">
        {#if filtered && matching !== null}
          {matching} matching
        {/if}
      </p>
    </div>
    <CardList {query} {refreshKey} />
  </div>
{:else}
  <Toolbar title="Leitner Box" />
  <div class="deck-body">
    {#if deckStore.loaded}
      <div class="empty-state">
        <p class="empty-state-title">Deck Not Found</p>
      </div>
    {/if}
  </div>
{/if}

<style>
  .deck-body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .filter-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s4);
    flex: none;
    height: var(--filter-bar-height);
    padding: 0 var(--s4);
    border-bottom: var(--hairline) solid var(--separator);
  }

  .filter-status {
    flex: 0 1 auto;
    min-width: 0;
    font: var(--text-callout) var(--font-system);
    color: var(--label-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
