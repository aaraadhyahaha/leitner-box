<script lang="ts" module>
  let nextId = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    wide = false,
    onclose,
    children,
    footer,
  }: {
    open?: boolean;
    title: string;
    wide?: boolean;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  const titleId = `sheet-${++nextId}-title`;

  let dialog: HTMLDialogElement | undefined = $state();
  // True between showModal() and the dialog's close event; guards onclose to once per close.
  let shown = false;

  $effect(() => {
    const el = dialog;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      shown = true;
      const target = el.querySelector<HTMLElement>('[data-autofocus]');
      if (target) target.focus();
      else el.focus();
    } else if (!open && el.open) {
      el.close();
    }
  });

  // Esc: close through state so the parent's binding updates; the close event then fires onclose.
  function handleCancelEvent(e: Event) {
    e.preventDefault();
    open = false;
  }

  // Fires for every close (Esc, parent setting open = false, or a forced browser close).
  function handleClose() {
    if (!shown) return;
    shown = false;
    open = false;
    onclose?.();
  }
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  class:wide
  tabindex="-1"
  aria-modal="true"
  aria-labelledby={titleId}
  oncancel={handleCancelEvent}
  onclose={handleClose}
>
  <h2 id={titleId} class="sheet-title" {title}>{title}</h2>
  <div class="sheet-body">
    {@render children()}
  </div>
  {#if footer}
    <div class="sheet-footer">
      {@render footer()}
    </div>
  {/if}
</dialog>

<style>
  .sheet {
    margin: auto;
    width: var(--sheet-width);
    max-width: calc(100vw - var(--s8));
    max-height: var(--sheet-max-height);
    padding: 0;
    border: none;
    border-radius: var(--radius-sheet);
    background: var(--bg-sheet);
    color: var(--label);
    box-shadow: var(--shadow-sheet);
  }

  .sheet.wide {
    width: var(--sheet-width-wide);
  }

  .sheet[open] {
    display: flex;
    flex-direction: column;
    animation: sheet-in var(--dur-sheet) var(--ease);
  }

  .sheet:focus {
    outline: none;
  }

  .sheet::backdrop {
    background: var(--backdrop);
    animation: sheet-fade var(--dur-sheet) var(--ease);
  }

  .sheet-title {
    flex: none;
    padding: var(--s4) var(--s5);
    font: var(--text-headline) var(--font-system);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sheet-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 0 var(--s5);
  }

  .sheet-footer {
    flex: none;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--s2);
    padding: var(--s4) var(--s5);
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(calc(var(--s2)));
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes sheet-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
