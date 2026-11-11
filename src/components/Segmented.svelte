<script lang="ts">
  let {
    value = $bindable(),
    options,
    label,
  }: {
    value: string;
    options: { value: string; label: string; count?: number }[];
    label: string;
  } = $props();

  let buttons: HTMLButtonElement[] = $state([]);

  // The tab stop is the selected segment, or the first one if nothing matches.
  const tabIndexOf = $derived.by(() => {
    const i = options.findIndex((o) => o.value === value);
    return i < 0 ? 0 : i;
  });

  function select(i: number) {
    value = options[i].value;
    buttons[i]?.focus();
  }

  function handleKeydown(e: KeyboardEvent, i: number) {
    const n = options.length;
    if (n === 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    select(next);
  }
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
  {#each options as option, i (option.value)}
    <button
      bind:this={buttons[i]}
      type="button"
      class="segment"
      role="radio"
      aria-checked={option.value === value}
      tabindex={i === tabIndexOf ? 0 : -1}
      onclick={() => select(i)}
      onkeydown={(e) => handleKeydown(e, i)}
    >
      <span class="segment-label">{option.label}</span>
      {#if option.count !== undefined}
        <span class="segment-count">{option.count}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    align-items: stretch;
    height: var(--control-height);
    padding: var(--hairline);
    border-radius: var(--radius-control);
    background: var(--fill-hover);
  }

  .segment {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    padding: 0 var(--s3);
    border: var(--hairline) solid transparent;
    border-radius: calc(var(--radius-control) - var(--hairline));
    background: transparent;
    color: var(--label);
    font: var(--text-body) var(--font-system);
    white-space: nowrap;
    cursor: default;
    -webkit-appearance: none;
    appearance: none;
  }

  .segment[aria-checked='true'] {
    background: var(--bg-control);
    border-color: var(--control-border);
  }

  .segment-count {
    color: var(--label-secondary);
    font-variant-numeric: tabular-nums;
  }
</style>
