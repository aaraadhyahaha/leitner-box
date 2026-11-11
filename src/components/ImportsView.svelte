<script lang="ts">
  import { untrack } from 'svelte';
  import { Trash2 } from '@lucide/svelte';
  import Toolbar from './Toolbar.svelte';
  import Alert from './Alert.svelte';
  import ExportButton from './ExportButton.svelte';
  import { call } from '../lib/db/client';
  import type { BatchSummary } from '../lib/db/types';
  import { deckStore, refreshDecks } from '../lib/decks.svelte';

  let batches: BatchSummary[] = $state.raw([]);
  let loaded = $state(false);
  let error: string | null = $state(null);
  let generation = 0;

  async function load() {
    const gen = ++generation;
    try {
      const list = await call('batch.list', null);
      if (gen !== generation) return;
      batches = list;
      error = null;
    } catch (e) {
      if (gen !== generation) return;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (gen === generation) loaded = true;
    }
  }

  // Load on mount and whenever the deck list changes (an import or delete elsewhere).
  $effect(() => {
    void deckStore.decks;
    untrack(() => {
      void load();
    });
  });

  const subtitle = $derived(
    loaded && !error ? (batches.length === 1 ? '1 import' : `${batches.length} imports`) : '',
  );

  function plural(n: number, word: string): string {
    return `${n} ${n === 1 ? word : `${word}s`}`;
  }

  function decksText(b: BatchSummary): string {
    return b.deckCount === 1 ? b.deckName : plural(b.deckCount, 'deck');
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' });
  const titleFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  let pending = $state<BatchSummary | null>(null);
  let confirmOpen = $state(false);
  let failOpen = $state(false);
  let failMessage = $state('');
  let deleting = $state(false);

  const confirmMessage = $derived(
    pending
      ? `“${pending.source}” added ${plural(pending.cardCount, 'card')} that are still in your library. They will be deleted. This can’t be undone.`
      : '',
  );

  function askDelete(b: BatchSummary) {
    if (deleting) return;
    pending = b;
    confirmOpen = true;
  }

  async function confirmDelete() {
    const b = pending;
    if (!b || deleting) return;
    deleting = true;
    try {
      await call('batch.delete', { id: b.id });
      await Promise.all([load(), refreshDecks()]);
    } catch (e) {
      failMessage = e instanceof Error ? e.message : String(e);
      failOpen = true;
    } finally {
      deleting = false;
      pending = null;
    }
  }
</script>

<Toolbar title="Imports" {subtitle}>
  {#if deckStore.decks.length > 0}
    <ExportButton />
  {/if}
</Toolbar>
<div class="imports-body">
  {#if error}
    <div class="empty-state">
      <p class="empty-state-title">Couldn’t Load Imports</p>
      <p class="empty-state-message">{error}</p>
    </div>
  {:else if loaded && batches.length === 0}
    <div class="empty-state">
      <p class="empty-state-title">No Imports</p>
      <p class="empty-state-message">Files you import are listed here so you can remove them in one step.</p>
    </div>
  {:else if loaded}
    <ul class="imports-list" aria-label="Imports">
      {#each batches as b (b.id)}
        {@const decks = decksText(b)}
        {@const cards = plural(b.cardCount, 'card')}
        <li class="list-row import-row">
          <span class="import-source" title={b.source}>{b.source}</span>
          <span class="import-decks" title={decks}>{decks}</span>
          <span class="import-cards">{cards}</span>
          <time
            class="import-date"
            datetime={new Date(b.createdAt).toISOString()}
            title={titleFormat.format(b.createdAt)}
          >
            {dateFormat.format(b.createdAt)}
          </time>
          <button
            type="button"
            class="btn-icon"
            aria-label="Delete import {b.source}"
            title="Delete import {b.source}"
            disabled={deleting}
            onclick={() => askDelete(b)}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<Alert
  bind:open={confirmOpen}
  title="Delete Import?"
  message={confirmMessage}
  confirmLabel="Delete"
  cancelLabel="Cancel"
  destructive
  onconfirm={confirmDelete}
  oncancel={() => (pending = null)}
/>
<Alert bind:open={failOpen} title="Delete Failed" message={failMessage} />

<style>
  .imports-body {
    min-height: 0;
    overflow-y: auto;
  }

  .imports-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .import-row {
    font: var(--text-body) var(--font-system);
    padding-right: var(--s1);
  }

  .import-source {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .import-decks {
    flex: 0 1 auto;
    max-width: calc(var(--search-width) - var(--s8));
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--label-secondary);
  }

  .import-cards {
    flex: none;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .import-date {
    flex: none;
    color: var(--label-secondary);
    font-variant-numeric: tabular-nums;
  }
</style>
