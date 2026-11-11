<script lang="ts">
  import Toolbar from './Toolbar.svelte';
  import ImportButton from './ImportButton.svelte';
  import SearchField from './SearchField.svelte';
  import Segmented from './Segmented.svelte';
  import CardList from './CardList.svelte';
  import Alert from './Alert.svelte';
  import ExportButton from './ExportButton.svelte';
  import CardEditorSheet from './CardEditorSheet.svelte';
  import DeckNameSheet from './DeckNameSheet.svelte';
  import { Pencil, Plus, Trash2 } from '@lucide/svelte';
  import { call } from '../lib/db/client';
  import type { Box, Card, CardQuery } from '../lib/db/types';
  import { deckStore, refreshDecks } from '../lib/decks.svelte';
  import { go } from '../lib/router.svelte';
  import { count, fmt } from '../lib/format';
  import { Selection } from '../lib/selection.svelte';

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

  // Bumped after each card save so edits that keep the counts still reload the list.
  let edits = $state(0);
  const refreshKey = $derived(deck ? `${deck.total}:${deck.boxes.join()}:${edits}` : '');

  let editorOpen = $state(false);
  let editorCard: Card | null = $state.raw(null);
  let renameOpen = $state(false);
  let renameTarget: { id: number; name: string } | null = $state.raw(null);

  function openEditor(card: Card | null) {
    if (!deck) return;
    editorCard = card;
    editorOpen = true;
  }

  function openRename() {
    if (!deck) return;
    renameTarget = { id: deck.id, name: deck.name };
    renameOpen = true;
  }

  async function onCardSaved() {
    edits++;
    await refreshDecks();
  }

  const subtitle = $derived(
    deck ? `${count(deck.total, 'card')} · ${fmt(deck.due)} due` : '',
  );

  const selection = new Selection();

  // Reset search, filter and selection when switching decks.
  let lastDeckId: number | null = null;
  $effect.pre(() => {
    if (lastDeckId !== null && deckId !== lastDeckId) {
      search = '';
      boxValue = 'all';
      selection.clear();
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
    // Queue the count after the list's page request: the worker is serial and a count over
    // a common term takes longer than the page itself.
    const timer = setTimeout(() => {
      call('card.count', q).then(
        (n) => {
          if (gen === countGen) matching = n;
        },
        () => {
          if (gen === countGen) matching = null;
        },
      );
    });
    return () => clearTimeout(timer);
  });

  // Total matching rows: the count when filtering, otherwise the deck total.
  const total: number | null = $derived(deck ? (filtered ? matching : deck.total) : null);
  // Selected rows; null while an "all" selection waits for the total.
  const selectedCount: number | null = $derived(
    selection.state.mode === 'ids'
      ? selection.state.ids.size
      : total === null
        ? null
        : selection.count(total),
  );
  const hasSelection = $derived(selectedCount === null || selectedCount > 0);

  function cardsLabel(n: number, capital: boolean): string {
    const word = capital ? (n === 1 ? 'Card' : 'Cards') : n === 1 ? 'card' : 'cards';
    return `${fmt(n)} ${word}`;
  }

  let deleteCardsOpen = $state(false);
  let deleteCardsTitle = $state('');
  let deleteDeckOpen = $state(false);
  let failOpen = $state(false);
  let failMessage = $state('');
  let deleting = $state(false);

  function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  function askDeleteCards() {
    if (deleting || selectedCount === null || selectedCount === 0) return;
    deleteCardsTitle = `Delete ${cardsLabel(selectedCount, true)}?`;
    deleteCardsOpen = true;
  }

  async function deleteCards() {
    const req = selection.toRequest(query);
    if (!req || deleting) return;
    deleting = true;
    try {
      await call('card.delete', req);
      selection.clear();
      await refreshDecks();
    } catch (e) {
      failMessage = errorText(e);
      failOpen = true;
    } finally {
      deleting = false;
    }
  }

  function askDeleteDeck() {
    if (deleting || !deck) return;
    deleteDeckOpen = true;
  }

  async function deleteDeck() {
    if (deleting) return;
    deleting = true;
    try {
      await call('deck.delete', { id: deckId });
      await refreshDecks();
      go({ name: 'home' });
    } catch (e) {
      failMessage = errorText(e);
      failOpen = true;
    } finally {
      deleting = false;
    }
  }

  function study() {
    if (!deck || deck.due === 0) return;
    go({ name: 'study', deckId });
  }

  function isTyping(t: EventTarget | null): boolean {
    return t instanceof Element && t.closest('input, textarea, select, [contenteditable]') !== null;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    if ((e.key === 'n' || e.key === 'N') && !e.shiftKey) {
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable], [role="listbox"]')) return;
      if (!deck) return;
      e.preventDefault();
      openEditor(null);
      return;
    }
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
    <button
      type="button"
      class="btn-icon"
      aria-label="New Card"
      title="New Card"
      onclick={() => openEditor(null)}
    >
      <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="btn-icon"
      aria-label="Rename Deck…"
      title="Rename Deck…"
      onclick={openRename}
    >
      <Pencil size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
    <ExportButton {deckId} />
    <button
      type="button"
      class="btn-icon"
      aria-label="Delete Deck…"
      title="Delete Deck…"
      disabled={deleting}
      onclick={askDeleteDeck}
    >
      <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
    <ImportButton deckName={deck.name} />
    <button type="button" class="btn btn-primary" disabled={deck.due === 0} onclick={study}>
      Study
    </button>
  </Toolbar>
  <div class="deck-body">
    <div class="filter-bar">
      <Segmented bind:value={boxValue} options={boxOptions} label="Box filter" />
      {#if hasSelection}
        <div class="filter-selection">
          <p class="filter-status" aria-live="polite">
            {#if selectedCount !== null}
              {fmt(selectedCount)} selected
            {/if}
          </p>
          {#if selection.state.mode === 'ids' && total !== null && selectedCount !== null && selectedCount < total}
            <button type="button" class="btn" onclick={() => selection.selectAll()}>
              Select All {fmt(total)} Matching
            </button>
          {/if}
          <button
            type="button"
            class="btn btn-destructive"
            disabled={deleting || selectedCount === null}
            onclick={askDeleteCards}
          >
            Delete…
          </button>
        </div>
      {:else}
        <p class="filter-status" aria-live="polite">
          {#if filtered && matching !== null}
            {fmt(matching)} matching
          {/if}
        </p>
      {/if}
    </div>
    <CardList
      {query}
      {selection}
      {refreshKey}
      onopen={(card) => openEditor(card)}
      ondelete={askDeleteCards}
    />
  </div>
  <Alert
    bind:open={deleteCardsOpen}
    title={deleteCardsTitle}
    message="This can’t be undone."
    confirmLabel="Delete"
    cancelLabel="Cancel"
    destructive
    onconfirm={deleteCards}
  />
  <Alert
    bind:open={deleteDeckOpen}
    title="Delete “{deck.name}”?"
    message="Its {cardsLabel(deck.total, false)} will be deleted. This can’t be undone."
    confirmLabel="Delete"
    cancelLabel="Cancel"
    destructive
    onconfirm={deleteDeck}
  />
  <CardEditorSheet bind:open={editorOpen} card={editorCard} {deckId} onsaved={onCardSaved} />
  <DeckNameSheet bind:open={renameOpen} deck={renameTarget} />
{:else}
  <Toolbar title="Leitner" />
  <div class="deck-body">
    {#if deckStore.loaded}
      <div class="empty-state">
        <p class="empty-state-title">Deck Not Found</p>
      </div>
    {/if}
  </div>
{/if}

<Alert bind:open={failOpen} title="Delete Failed" message={failMessage} />

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

  .filter-selection {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex: 0 1 auto;
    min-width: 0;
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
