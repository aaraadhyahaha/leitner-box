<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import RichText from '../lib/render/RichText.svelte';
  import { call } from '../lib/db/client';
  import { deckStore } from '../lib/decks.svelte';
  import type { Card } from '../lib/db/types';

  let {
    open = $bindable(false),
    card = null,
    deckId,
    onsaved,
  }: {
    open?: boolean;
    card?: Card | null;
    deckId: number;
    onsaved?: (card: Card) => void;
  } = $props();

  const PREVIEW_DELAY = 150;

  let selectedDeck = $state(0);
  let front = $state('');
  let back = $state('');
  let tags = $state('');
  let previewFront = $state('');
  let previewBack = $state('');
  let saving = $state(false);
  let error: string | null = $state(null);
  let editingId: number | null = null;
  let editorEl: HTMLDivElement | undefined = $state();

  const title = $derived(card ? 'Edit Card' : 'New Card');
  const canSave = $derived(!saving && front.trim() !== '' && back.trim() !== '');

  function init() {
    editingId = card ? card.id : null;
    selectedDeck = card ? card.deckId : deckId;
    front = card ? card.front : '';
    back = card ? card.back : '';
    tags = card ? card.tags.join(' ') : '';
    previewFront = front;
    previewBack = back;
    saving = false;
    error = null;
  }

  // Initialise the fields each time the sheet opens.
  $effect.pre(() => {
    if (open) untrack(init);
  });

  // Preview copies follow the text once typing pauses.
  $effect(() => {
    const f = front;
    const b = back;
    const timer = setTimeout(() => {
      previewFront = f;
      previewBack = b;
    }, PREVIEW_DELAY);
    return () => clearTimeout(timer);
  });

  function parseTags(s: string): string[] {
    return s.split(/[\s,]+/).filter((t) => t !== '');
  }

  async function save() {
    if (!canSave) return;
    saving = true;
    error = null;
    const input = { deckId: selectedDeck, front, back, tags: parseTags(tags) };
    try {
      const saved =
        editingId === null
          ? await call('card.create', input)
          : await call('card.update', { ...input, id: editingId });
      saving = false;
      onsaved?.(saved);
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      saving = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  }

  // Ctrl/⌘+Enter on the sheet content saves.
  $effect(() => {
    const el = editorEl;
    if (!el) return;
    el.addEventListener('keydown', onkeydown);
    return () => el.removeEventListener('keydown', onkeydown);
  });
</script>

<Sheet bind:open {title} wide>
  <div class="editor" bind:this={editorEl}>
    <div class="fields">
      <div>
        <label class="field-label" for="card-editor-deck">Deck</label>
        <select id="card-editor-deck" class="field" bind:value={selectedDeck}>
          {#each deckStore.decks as d (d.id)}
            <option value={d.id}>{d.name}</option>
          {/each}
        </select>
      </div>
      <div>
        <label class="field-label" for="card-editor-front">Front</label>
        <textarea id="card-editor-front" class="field" data-autofocus bind:value={front}></textarea>
      </div>
      <div>
        <label class="field-label" for="card-editor-back">Back</label>
        <textarea id="card-editor-back" class="field" bind:value={back}></textarea>
      </div>
      <div>
        <label class="field-label" for="card-editor-tags">Tags</label>
        <input
          id="card-editor-tags"
          class="field"
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value={tags}
        />
      </div>
      {#if error !== null}
        <p class="field-error" role="alert">{error}</p>
      {/if}
    </div>
    <div class="preview-column">
      <p class="field-label" id="card-editor-preview">Preview</p>
      <div class="preview" aria-labelledby="card-editor-preview" role="region">
        <div class="preview-side"><RichText source={previewFront} /></div>
        <hr class="preview-rule" />
        <div class="preview-side"><RichText source={previewBack} /></div>
      </div>
    </div>
  </div>

  {#snippet footer()}
    <button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
    <button type="button" class="btn btn-primary" disabled={!canSave} onclick={save}>Save</button>
  {/snippet}
</Sheet>

<style>
  .editor {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s5);
    padding-bottom: var(--s1);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    min-width: 0;
  }

  .preview-column {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .preview {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: var(--s4);
    border-radius: var(--radius-control);
    background: var(--bg-content);
    color: var(--label);
    font: var(--text-card) var(--font-system);
    overflow-wrap: anywhere;
  }

  .preview-rule {
    margin: var(--s4) 0;
    border: none;
    border-top: var(--hairline) solid var(--separator);
  }
</style>
