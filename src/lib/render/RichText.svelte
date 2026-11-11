<script lang="ts">
  import 'katex/dist/katex.min.css';
  import { renderToHtml } from './render';
  import { hydrateSmiles } from './smiles';

  let { source }: { source: string } = $props();
  let el: HTMLDivElement | undefined = $state();

  $effect(() => {
    void source;
    if (el) void hydrateSmiles(el);
  });
</script>

<div class="rich-text" bind:this={el}>{@html renderToHtml(source)}</div>

<style>
  .rich-text {
    user-select: text;
    -webkit-user-select: text;
  }
  .rich-text :global(.render-warn) {
    color: var(--orange);
    text-decoration: underline dotted;
    text-decoration-thickness: 1px;
    cursor: help;
  }
  .rich-text :global(.smiles) {
    display: block;
    text-align: center;
    margin: var(--s2) 0;
  }
  .rich-text :global(.smiles-svg) {
    display: block;
    margin: 0 auto;
  }
  .rich-text :global(.smiles-caption) {
    display: block;
    margin-top: var(--s1);
    font: var(--text-callout) var(--font-system);
    color: var(--label-secondary);
  }
</style>
