<script lang="ts">
  import Toolbar from './Toolbar.svelte';
  import ImportButton from './ImportButton.svelte';
  import { deckStore } from '../lib/decks.svelte';
  import { go } from '../lib/router.svelte';

  let { deckId }: { deckId: number } = $props();

  const deck = $derived(deckStore.decks.find((d) => d.id === deckId) ?? null);

  function study() {
    if (!deck || deck.due === 0) return;
    go({ name: 'study', deckId });
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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
  <Toolbar title={deck.name} subtitle={deck.total === 1 ? '1 card' : `${deck.total} cards`}>
    <ImportButton deckName={deck.name} />
  </Toolbar>
  <div class="deck-scroller">
    <div class="deck-content">
      <div class="deck-due">
        {#if deck.due > 0}
          <p class="deck-due-count">{deck.due}</p>
          <p class="deck-due-label">due today</p>
        {:else}
          <p class="deck-due-count">0</p>
          <p class="deck-due-label">Nothing due today</p>
        {/if}
      </div>
      <ul class="deck-boxes" aria-label="Cards per box">
        {#each deck.boxes as count, i (i)}
          <li class="deck-box">
            <span class="deck-box-count">{count}</span>
            <span class="deck-box-label">Box {i + 1}</span>
          </li>
        {/each}
      </ul>
      <button
        type="button"
        class="btn btn-primary btn-large"
        disabled={deck.due === 0}
        onclick={study}
      >
        Study
      </button>
    </div>
  </div>
{:else}
  <Toolbar title="Leitner Box" />
  <div class="deck-scroller">
    {#if deckStore.loaded}
      <div class="empty-state">
        <p class="empty-state-title">Deck Not Found</p>
      </div>
    {/if}
  </div>
{/if}

<style>
  .deck-scroller {
    min-height: 0;
    overflow-y: auto;
  }

  .deck-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s6);
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--s8);
  }

  .deck-due {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .deck-due-count {
    font: var(--text-large-title) var(--font-system);
    color: var(--label);
    font-variant-numeric: tabular-nums;
  }

  .deck-due-label {
    font: var(--text-callout) var(--font-system);
    color: var(--label-secondary);
  }

  .deck-boxes {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .deck-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s1);
    padding: var(--s2) var(--s1);
    min-width: 0;
  }

  .deck-box + .deck-box {
    border-left: var(--hairline) solid var(--separator);
  }

  .deck-box-count {
    font: var(--text-title2) var(--font-system);
    color: var(--label);
    font-variant-numeric: tabular-nums;
  }

  .deck-box-label {
    font: var(--text-footnote) var(--font-system);
    color: var(--label-secondary);
  }
</style>
