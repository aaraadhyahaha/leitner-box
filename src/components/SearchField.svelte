<script lang="ts">
  import { Search, X } from '@lucide/svelte';

  let {
    value = $bindable(''),
    placeholder = 'Search',
    delay = 150,
  }: {
    value?: string;
    placeholder?: string;
    delay?: number;
  } = $props();

  let input: HTMLInputElement | undefined = $state();
  let text = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Follow outside changes to `value` (only `value` is tracked here).
  $effect(() => {
    text = value;
    clearTimeout(timer);
  });

  $effect(() => () => clearTimeout(timer));

  export function focus(): void {
    input?.focus();
  }

  function handleInput(e: Event) {
    text = (e.currentTarget as HTMLInputElement).value;
    clearTimeout(timer);
    if (text === '') {
      value = '';
      return;
    }
    timer = setTimeout(() => {
      value = text;
    }, delay);
  }

  function clear() {
    clearTimeout(timer);
    text = '';
    value = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (text !== '') clear();
    else input?.blur();
  }

  function handleClearClick() {
    clear();
    input?.focus();
  }
</script>

<div class="search-field">
  <span class="search-icon" aria-hidden="true">
    <Search size={16} stroke-width={1.5} />
  </span>
  <input
    bind:this={input}
    class="field search-input"
    type="search"
    {placeholder}
    aria-label={placeholder}
    value={text}
    oninput={handleInput}
    onkeydown={handleKeydown}
    autocomplete="off"
    spellcheck="false"
  />
  {#if text !== ''}
    <button
      type="button"
      class="search-clear"
      aria-label="Clear Search"
      title="Clear Search"
      onclick={handleClearClick}
    >
      <X size={14} stroke-width={1.5} />
    </button>
  {/if}
</div>

<style>
  .search-field {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: var(--search-width);
    flex: none;
  }

  .search-icon {
    position: absolute;
    left: var(--s2);
    display: inline-flex;
    color: var(--label-secondary);
    pointer-events: none;
  }

  .search-icon :global(svg) {
    width: var(--icon);
    height: var(--icon);
  }

  .search-input {
    padding-left: calc(var(--s2) + var(--icon) + var(--s1));
    padding-right: var(--control-height);
    -webkit-appearance: none;
    appearance: none;
  }

  .search-input::-webkit-search-cancel-button,
  .search-input::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
    display: none;
  }

  /* 28 px hit target (the full field height); the glyph stays small like a native search field. */
  .search-clear {
    position: absolute;
    right: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height);
    height: var(--control-height);
    padding: 0;
    border: none;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--label-secondary);
    cursor: default;
  }

  .search-clear:hover {
    background: var(--fill-hover);
  }

  .search-clear:active {
    background: var(--bg-control-pressed);
  }
</style>
