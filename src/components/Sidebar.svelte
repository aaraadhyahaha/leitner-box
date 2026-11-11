<script lang="ts">
  import { deckStore } from '../lib/decks.svelte';
  import { router, go } from '../lib/router.svelte';

  const decks = $derived(deckStore.decks);

  const selectedId = $derived(
    router.route.name === 'deck' || router.route.name === 'study' ? router.route.deckId : null,
  );

  const selectedIndex = $derived(
    selectedId === null ? -1 : decks.findIndex((d) => d.id === selectedId),
  );

  // Keyboard cursor; follows the route-selected row, defaults to the first row.
  let cursor = $state(-1);
  const activeIndex = $derived(
    selectedIndex >= 0 ? selectedIndex : cursor >= 0 && cursor < decks.length ? cursor : -1,
  );

  let listEl: HTMLElement | undefined = $state();

  function rowId(id: number): string {
    return `sidebar-deck-${id}`;
  }

  function open(index: number) {
    const d = decks[index];
    if (!d) return;
    cursor = index;
    go({ name: 'deck', deckId: d.id });
    document.getElementById(rowId(d.id))?.scrollIntoView({ block: 'nearest' });
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || decks.length === 0) return;
    const current = activeIndex;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open(current < 0 ? 0 : Math.min(current + 1, decks.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      open(current < 0 ? 0 : Math.max(current - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      open(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      open(decks.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(current < 0 ? 0 : current);
    }
  }

  function onclick(e: MouseEvent) {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-index]') : null;
    if (!row) return;
    open(Number(row.dataset.index));
    listEl?.focus();
  }
</script>

<nav class="sidebar" aria-label="Decks">
  <h2 class="sidebar-header" id="sidebar-decks-header">Decks</h2>
  {#if decks.length === 0}
    {#if deckStore.loaded}
      <div class="empty-state sidebar-empty">
        <p class="empty-state-title">No Decks</p>
      </div>
    {/if}
  {:else}
    <div
      bind:this={listEl}
      class="sidebar-list"
      role="listbox"
      tabindex="0"
      aria-labelledby="sidebar-decks-header"
      aria-activedescendant={activeIndex >= 0 ? rowId(decks[activeIndex].id) : undefined}
      {onkeydown}
      {onclick}
    >
      {#each decks as deck, i (deck.id)}
        <div
          id={rowId(deck.id)}
          class="sidebar-row"
          class:selected={deck.id === selectedId}
          class:active={i === activeIndex}
          role="option"
          aria-selected={deck.id === selectedId}
          data-index={i}
        >
          <span class="sidebar-name" title={deck.name}>{deck.name}</span>
          {#if deck.due > 0}
            <span class="sidebar-badge" aria-label="{deck.due} due">{deck.due}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</nav>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    padding: var(--s2);
    background: var(--bg-sidebar);
    border-right: var(--hairline) solid var(--separator);
  }

  .sidebar-header {
    padding: var(--s2);
    font: var(--text-subhead) var(--font-system);
    font-weight: 600;
    color: var(--label-secondary);
  }

  .sidebar-list {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-row);
  }

  .sidebar-list:focus-visible {
    outline-offset: 0;
  }

  .sidebar-row {
    display: flex;
    align-items: center;
    gap: var(--s2);
    height: var(--row-height);
    min-height: var(--row-height);
    padding: 0 var(--s2);
    border-radius: var(--radius-row);
    color: var(--label);
    font: var(--text-body) var(--font-system);
    cursor: default;
  }

  .sidebar-row:hover {
    background: var(--fill-hover);
  }

  .sidebar-row.selected {
    background: var(--fill-selected);
  }

  .sidebar-list:focus-visible .sidebar-row.active:not(.selected) {
    outline: 1px solid var(--focus-ring);
    outline-offset: -1px;
  }

  .sidebar-name {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidebar-badge {
    flex: none;
    font: var(--text-subhead) var(--font-system);
    color: var(--label-secondary);
    font-variant-numeric: tabular-nums;
  }

  .sidebar-empty {
    height: auto;
    padding: var(--s4) var(--s2);
  }

  .sidebar-empty .empty-state-title {
    font: var(--text-body) var(--font-system);
  }
</style>
