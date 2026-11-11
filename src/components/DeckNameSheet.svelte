<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import { call } from '../lib/db/client';
  import { refreshDecks } from '../lib/decks.svelte';

  let {
    open = $bindable(false),
    deck = null,
    onsaved,
  }: {
    open?: boolean;
    deck?: { id: number; name: string } | null;
    onsaved?: (id: number) => void;
  } = $props();

  let name = $state('');
  let saving = $state(false);
  let error: string | null = $state(null);
  let renamingId: number | null = null;

  const title = $derived(deck ? 'Rename Deck' : 'New Deck');
  const actionLabel = $derived(deck ? 'Rename' : 'Create');
  const canSave = $derived(!saving && name.trim() !== '');

  // Prefill each time the sheet opens.
  $effect.pre(() => {
    if (open)
      untrack(() => {
        renamingId = deck ? deck.id : null;
        name = deck ? deck.name : '';
        saving = false;
        error = null;
      });
  });

  async function save() {
    if (!canSave) return;
    saving = true;
    error = null;
    const trimmed = name.trim();
    try {
      let id: number;
      if (renamingId === null) {
        id = (await call('deck.create', { name: trimmed })).id;
      } else {
        id = renamingId;
        await call('deck.rename', { id, name: trimmed });
      }
      await refreshDecks();
      saving = false;
      onsaved?.(id);
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      saving = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  }
</script>

<Sheet bind:open {title}>
  <div class="deck-name">
    <label class="field-label" for="deck-name-input">Name</label>
    <input
      id="deck-name-input"
      class="field"
      type="text"
      autocomplete="off"
      data-autofocus
      bind:value={name}
      {onkeydown}
    />
    {#if error !== null}
      <p class="field-error" role="alert">{error}</p>
    {/if}
  </div>

  {#snippet footer()}
    <button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
    <button type="button" class="btn btn-primary" disabled={!canSave} onclick={save}>
      {actionLabel}
    </button>
  {/snippet}
</Sheet>

<style>
  .deck-name {
    padding-bottom: var(--s1);
  }

  .deck-name .field-error {
    margin-top: var(--s1);
  }
</style>
