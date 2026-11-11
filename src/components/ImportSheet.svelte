<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Segmented from './Segmented.svelte';
  import Alert from './Alert.svelte';
  import { call } from '../lib/db/client';
  import { refreshDecks } from '../lib/decks.svelte';
  import { sampleWarnings, type RenderWarning } from '../lib/render/warnings';
  import type { ImportResult } from '../lib/db/types';
  import { count, fmt } from '../lib/format';

  let { open = $bindable(false), deckName = null }: { open?: boolean; deckName?: string | null } =
    $props();

  const PREVIEW_DELAY = 400;
  const SOURCES = [
    { value: 'file', label: 'File' },
    { value: 'paste', label: 'Paste' },
  ];

  let source = $state('file');
  let file = $state<File | null>(null);
  let text = $state('');
  let defaultDeck = $state('');
  let deckEdited = $state(false);

  let previewing = $state(false);
  let result = $state<ImportResult | null>(null);
  let previewError = $state<string | null>(null);
  let warnings = $state<RenderWarning[]>([]);
  let importing = $state(false);

  let alertOpen = $state(false);
  let alertMessage = $state('');

  let fileInput: HTMLInputElement | undefined = $state();
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSource = 'file';

  const added = $derived(result?.added ?? 0);
  const importLabel = $derived(`Import ${count(added, 'Card')}`);
  const canImport = $derived(!previewing && !importing && previewError === null && added > 0);
  const moreErrors = $derived(result ? result.errorCount - result.errors.length : 0);

  function baseName(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function applySuggestion() {
    if (deckEdited) return;
    defaultDeck = deckName ?? (source === 'file' && file ? baseName(file.name) : 'Imported');
  }

  function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  function currentFile(): File | null {
    if (source === 'file') return file;
    if (text.trim() === '') return null;
    return new File([text], 'Pasted text', { type: 'text/plain' });
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function clearPreview() {
    generation++;
    previewing = false;
    result = null;
    previewError = null;
    warnings = [];
  }

  async function runPreview() {
    timer = null;
    const f = currentFile();
    if (!f) {
      clearPreview();
      return;
    }
    const gen = ++generation;
    previewing = true;
    try {
      const r = await call('import.run', { file: f, defaultDeck: defaultDeck.trim(), commit: false });
      if (gen !== generation) return;
      result = r;
      previewError = null;
      warnings = [];
      previewing = false;
      const w = await sampleWarnings(r.sample);
      if (gen !== generation) return;
      warnings = w;
    } catch (e) {
      if (gen !== generation) return;
      result = null;
      warnings = [];
      previewError = messageOf(e);
      previewing = false;
    }
  }

  function schedulePreview(delay: number) {
    clearTimer();
    if (!currentFile()) {
      clearPreview();
      return;
    }
    // Invalidate any in-flight preview and disable Import until the new one lands.
    generation++;
    previewing = true;
    if (delay <= 0) void runPreview();
    else timer = setTimeout(() => void runPreview(), delay);
  }

  // Prefill the default deck each time the sheet opens.
  $effect(() => {
    if (open) untrack(applySuggestion);
  });

  // Switching source re-suggests the deck name and re-runs the preview.
  $effect(() => {
    const s = source;
    untrack(() => {
      if (s === lastSource) return;
      lastSource = s;
      if (!open) return;
      applySuggestion();
      schedulePreview(0);
    });
  });

  function chooseFile() {
    fileInput?.click();
  }

  function onFileChange() {
    const f = fileInput?.files?.[0] ?? null;
    if (fileInput) fileInput.value = '';
    if (!f) return;
    file = f;
    applySuggestion();
    schedulePreview(0);
  }

  function onTextInput() {
    schedulePreview(PREVIEW_DELAY);
  }

  function onDeckInput() {
    deckEdited = true;
    schedulePreview(PREVIEW_DELAY);
  }

  async function doImport() {
    const f = currentFile();
    if (!f || !canImport) return;
    clearTimer();
    generation++;
    importing = true;
    try {
      await call('import.run', { file: f, defaultDeck: defaultDeck.trim(), commit: true });
      await refreshDecks();
      open = false;
    } catch (e) {
      alertMessage = messageOf(e);
      alertOpen = true;
    } finally {
      importing = false;
    }
  }

  function reset() {
    clearTimer();
    generation++;
    source = 'file';
    lastSource = 'file';
    file = null;
    text = '';
    defaultDeck = '';
    deckEdited = false;
    previewing = false;
    result = null;
    previewError = null;
    warnings = [];
    importing = false;
  }
</script>

<Sheet bind:open title="Import Cards" onclose={reset}>
  <div class="import">
    <Segmented bind:value={source} options={SOURCES} label="Source" />

    {#if source === 'file'}
      <div class="file-row">
        <button type="button" class="btn" data-autofocus onclick={chooseFile}>Choose File…</button>
        <span class="file-name" class:placeholder={!file} title={file?.name}>{file ? file.name : 'No file chosen'}</span>
        <input
          bind:this={fileInput}
          type="file"
          accept=".jsonl,.json,.txt"
          hidden
          tabindex="-1"
          aria-hidden="true"
          onchange={onFileChange}
        />
      </div>
    {:else}
      <div>
        <label class="field-label" for="import-paste">JSONL or JSON array</label>
        <textarea
          id="import-paste"
          class="field paste"
          data-autofocus
          spellcheck="false"
          placeholder={'{"front": "…", "back": "…"}'}
          bind:value={text}
          oninput={onTextInput}
        ></textarea>
      </div>
    {/if}

    <div>
      <label class="field-label" for="import-deck">Default deck</label>
      <input
        id="import-deck"
        class="field"
        type="text"
        autocomplete="off"
        bind:value={defaultDeck}
        oninput={onDeckInput}
      />
      <p class="caption">Used for cards without a deck field.</p>
    </div>

    {#if previewError !== null}
      <p class="field-error" role="alert">{previewError}</p>
    {:else if previewing || result}
      <ul class="counts" aria-label="Preview" aria-busy={previewing}>
        <li class="count-cell">
          <span class="count">{previewing ? '…' : fmt(result?.added ?? 0)}</span>
          <span class="count-label">New</span>
        </li>
        <li class="count-cell">
          <span class="count secondary">{previewing ? '…' : fmt(result?.duplicates ?? 0)}</span>
          <span class="count-label">Duplicates</span>
        </li>
        <li class="count-cell">
          <span class="count" class:red={!previewing && (result?.errorCount ?? 0) > 0}
            >{previewing ? '…' : fmt(result?.errorCount ?? 0)}</span
          >
          <span class="count-label">Errors</span>
        </li>
      </ul>

      {#if !previewing && result}
        {#if result.decks.length > 0}
          <table class="decks">
            <thead>
              <tr>
                <th scope="col">Deck</th>
                <th scope="col" class="num">Added</th>
              </tr>
            </thead>
            <tbody>
              {#each result.decks as d (d.name)}
                <tr>
                  <td>
                    <div class="deck-cell">
                      <span class="deck-name" title={d.name}>{d.name}</span>
                      {#if d.isNew}<span class="badge">New</span>{/if}
                    </div>
                  </td>
                  <td class="num">{fmt(d.added)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        {#if result.errors.length > 0}
          <section aria-label="Errors">
            <h3 class="list-heading">Errors</h3>
            <ul class="messages errors">
              {#each result.errors as err, i (i)}
                <li>Line {fmt(err.line)}: {err.message}</li>
              {/each}
              {#if moreErrors > 0}
                <li class="more">and {fmt(moreErrors)} more</li>
              {/if}
            </ul>
          </section>
        {/if}

        {#if warnings.length > 0}
          <section aria-label="Rendering warnings">
            <h3 class="list-heading">Rendering warnings (first 20 cards checked)</h3>
            <ul class="messages warnings">
              {#each warnings as w, i (i)}
                <li title={w.raw}>Line {fmt(w.line)}, {w.side}: {w.message}</li>
              {/each}
            </ul>
          </section>
        {/if}
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    <button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
    <button type="button" class="btn btn-primary" disabled={!canImport} onclick={doImport}>
      {importLabel}
    </button>
  {/snippet}
</Sheet>

<Alert bind:open={alertOpen} title="Import Failed" message={alertMessage} />

<style>
  .import {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    padding-bottom: var(--s1);
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-width: 0;
  }

  .file-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: var(--text-body) var(--font-system);
  }

  .file-name.placeholder {
    color: var(--label-secondary);
  }

  .paste {
    font: var(--text-body) var(--font-mono);
  }

  .caption {
    margin-top: var(--s1);
    font: var(--text-footnote) var(--font-system);
    color: var(--label-secondary);
  }

  .counts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .count-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s1);
    padding: var(--s2) var(--s1);
    min-width: 0;
  }

  .count-cell + .count-cell {
    border-left: var(--hairline) solid var(--separator);
  }

  .count {
    font: var(--text-title2) var(--font-system);
    color: var(--label);
    font-variant-numeric: tabular-nums;
  }

  .count.secondary {
    color: var(--label-secondary);
  }

  .count.red {
    color: var(--red);
  }

  .count-label {
    font: var(--text-footnote) var(--font-system);
    color: var(--label-secondary);
  }

  .decks {
    width: 100%;
    border-collapse: collapse;
    font: var(--text-body) var(--font-system);
  }

  .decks th {
    padding: var(--s1) var(--s2);
    font: var(--text-callout) var(--font-system);
    color: var(--label-secondary);
    text-align: left;
    border-bottom: var(--hairline) solid var(--separator);
  }

  .decks td {
    height: var(--row-height);
    padding: 0 var(--s2);
    border-bottom: var(--hairline) solid var(--separator);
  }

  .deck-cell {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-width: 0;
  }

  .deck-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .decks .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .list-heading {
    margin-bottom: var(--s1);
    font: var(--text-subhead) var(--font-system);
    color: var(--label-secondary);
  }

  .messages {
    max-height: calc(var(--s8) * 3.75);
    overflow: auto;
    margin: 0;
    padding: 0;
    list-style: none;
    font: var(--text-callout) var(--font-system);
    overflow-wrap: anywhere;
    user-select: text;
    -webkit-user-select: text;
  }

  .messages li + li {
    margin-top: var(--s1);
  }

  .messages.errors {
    color: var(--label);
  }

  .messages.warnings {
    color: var(--orange);
  }

  .messages .more {
    color: var(--label-secondary);
  }
</style>
