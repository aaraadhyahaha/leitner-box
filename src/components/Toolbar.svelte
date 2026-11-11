<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, subtitle = '', children }: { title: string; subtitle?: string; children?: Snippet } =
    $props();
</script>

<header class="toolbar">
  <div class="toolbar-titles">
    <h1 class="toolbar-title" {title}>{title}</h1>
    {#if subtitle}
      <p class="toolbar-subtitle" title={subtitle}>{subtitle}</p>
    {/if}
  </div>
  <div class="toolbar-actions">
    {@render children?.()}
  </div>
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--s4);
    flex: none;
    height: var(--toolbar-height);
    padding: 0 var(--s4);
    background: var(--bg-content);
    border-bottom: var(--hairline) solid var(--separator);
  }

  .toolbar-titles {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex: 1 1 auto;
    min-width: 0;
  }

  .toolbar-title {
    font: var(--text-headline) var(--font-system);
    color: var(--label);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toolbar-subtitle {
    font: var(--text-callout) var(--font-system);
    color: var(--label-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex: none;
  }
</style>
